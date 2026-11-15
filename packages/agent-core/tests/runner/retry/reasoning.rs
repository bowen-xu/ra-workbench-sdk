use super::*;

#[tokio::test]
async fn public_summary_output_uses_local_visible_output_retry_reset_but_empty_parts_do_not() {
    for text in ["", "public你"] {
        let (_, sink, ids, request) = setup(vec![]);
        let mut partial = vec![
            Ok(begin()),
            Ok(ModelStreamEvent::ReasoningSummaryStarted {
                item_id: "failed-summary".into(),
            }),
            Ok(ModelStreamEvent::ReasoningSummaryPartAdded {
                item_id: "failed-summary".into(),
                summary_index: i64::MAX.into(),
            }),
        ];
        if !text.is_empty() {
            partial.push(Ok(ModelStreamEvent::ReasoningSummaryDelta {
                item_id: "failed-summary".into(),
                summary_index: i64::MAX.into(),
                text: text.into(),
            }));
        }
        partial.push(Err(ModelError::Unavailable));
        let transport = script(vec![
            failure(ModelError::Unavailable, false),
            failure(ModelError::Unavailable, true),
            Step::Stream(partial),
            response(answer()),
        ]);
        let tools = Tools {
            sink: &sink,
            executed: AtomicUsize::new(0),
        };
        let waits = Arc::new(Mutex::new(vec![]));
        TurnRunner {
            transport: &transport,
            tools: &tools,
            sink: &sink,
            ids: &ids,
            limits: RunLimits {
                model_calls: Some(4),
                ..limits()
            },
        }
        .run_with_retry_wait(
            Uuid::from_u128(2),
            request,
            &NoAdditionalInputForTest,
            &RetryRecorder(waits.clone()),
        )
        .await
        .unwrap();
        assert_eq!(
            *waits.lock().unwrap(),
            if text.is_empty() {
                vec![250, 500, 1000]
            } else {
                vec![250, 500, 250]
            }
        );
        let state = sink.projection.lock().unwrap();
        assert!(
            state
                .turn(Uuid::from_u128(2))
                .unwrap()
                .items
                .values()
                .any(
                    |item| matches!(item.kind, ItemKind::ReasoningSummary { .. })
                        && item.interrupted
                        && !item.completed
                )
        );
        assert!(reconstruct_history(&state).unwrap().iter().all(|message|!matches!(message,ModelMessage::CanonicalOutput(item)if matches!(item.normalized,Some(ModelOutputItem::ReasoningSummary(_))))));
    }
}
