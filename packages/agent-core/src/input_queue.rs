//! Next-turn input, separate from same-turn steering. Hosts persist each accepted
//! transition atomically and authorize the conversation before applying it.
use crate::conversation::ConversationBinding;
use std::collections::HashSet;
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QueuedInput {
    pub id: Uuid,
    pub text: String,
    pub user_input: Vec<crate::user_input::UserInput>,
    /// Entry provenance only. Never a grant to access or freeze a resource.
    pub origin: Option<ConversationBinding>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InputQueue {
    conversation_id: Uuid,
    revision: u64,
    paused: bool,
    paused_inputs: HashSet<Uuid>,
    inputs: Vec<QueuedInput>,
    /// Preparation owns the head until durable submission admission or release.
    preparing: Option<Uuid>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum QueueEdit {
    Add(QueuedInput),
    /// The durable adapter verifies the removed source and restores its provenance.
    Restore {
        input: QueuedInput,
        source_id: Uuid,
        index: usize,
        paused: bool,
    },
    Update {
        id: Uuid,
        text: String,
        user_input: Vec<crate::user_input::UserInput>,
    },
    Remove(Uuid),
    Reorder(Vec<Uuid>),
    Pause,
    Resume,
    PauseInput(Uuid),
    ResumeInput(Uuid),
    Prepare(Uuid),
    /// Only after the host commits the input-to-submission association.
    Admitted(Uuid),
    /// Preparation failed/cancelled; retain text and require explicit resume.
    Release(Uuid),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum QueueError {
    #[error("invalid queue input or order")]
    Invalid,
    #[error("queue revision or input identity conflicts")]
    Conflict,
    #[error("input is being prepared")]
    Busy,
    #[error("queue is paused")]
    Paused,
    #[error("queue capacity reached")]
    Capacity,
}

impl InputQueue {
    pub fn new(conversation_id: Uuid) -> Result<Self, QueueError> {
        if conversation_id.is_nil() {
            return Err(QueueError::Invalid);
        }
        Ok(Self {
            conversation_id,
            revision: 0,
            paused: false,
            paused_inputs: HashSet::new(),
            inputs: vec![],
            preparing: None,
        })
    }

    pub fn conversation_id(&self) -> Uuid {
        self.conversation_id
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    pub fn paused(&self) -> bool {
        self.paused
    }
    pub fn inputs(&self) -> &[QueuedInput] {
        &self.inputs
    }
    pub fn preparing(&self) -> Option<Uuid> {
        self.preparing
    }
    pub fn input_paused(&self, id: Uuid) -> bool {
        self.paused_inputs.contains(&id)
    }
    /// Next eligible entry, retaining paused entries in their original order.
    pub fn next_input(&self) -> Option<&QueuedInput> {
        self.inputs
            .iter()
            .find(|input| !self.input_paused(input.id))
    }

    /// Restore a persisted snapshot without reopening preparation or replaying
    /// edits. An interrupted preparing input must be reconciled by its host.
    pub fn restore(
        conversation_id: Uuid,
        revision: u64,
        paused: bool,
        inputs: Vec<QueuedInput>,
        preparing: Option<Uuid>,
    ) -> Result<Self, QueueError> {
        Self::restore_with_paused_inputs(
            conversation_id,
            revision,
            paused,
            inputs,
            preparing,
            vec![],
        )
    }

    pub fn restore_with_paused_inputs(
        conversation_id: Uuid,
        revision: u64,
        paused: bool,
        inputs: Vec<QueuedInput>,
        preparing: Option<Uuid>,
        paused_inputs: Vec<Uuid>,
    ) -> Result<Self, QueueError> {
        let mut queue = Self::new(conversation_id)?;
        if inputs.len() > 64 {
            return Err(QueueError::Capacity);
        }
        let mut ids = HashSet::new();
        for input in &inputs {
            validate(input)?;
            if !ids.insert(input.id) {
                return Err(QueueError::Invalid);
            }
        }
        for id in paused_inputs {
            if !ids.contains(&id) || !queue.paused_inputs.insert(id) {
                return Err(QueueError::Invalid);
            }
        }
        queue.inputs = inputs;
        if preparing.is_some() && preparing != queue.next_input().map(|input| input.id) {
            return Err(QueueError::Invalid);
        }
        queue.revision = revision;
        queue.paused = paused;
        queue.preparing = preparing;
        Ok(queue)
    }

    /// Returns a replacement snapshot. Rejection never partially mutates the
    /// original. Durable adapters must compare-and-swap revision in a transaction
    /// and separately retain command receipts for ambiguous IPC retries.
    pub fn apply(&self, expected_revision: u64, edit: QueueEdit) -> Result<Self, QueueError> {
        if expected_revision != self.revision {
            return Err(QueueError::Conflict);
        }
        let mut next = self.clone();
        next.change(edit)?;
        next.revision = self.revision.checked_add(1).ok_or(QueueError::Capacity)?;
        Ok(next)
    }

    fn change(&mut self, edit: QueueEdit) -> Result<(), QueueError> {
        match edit {
            QueueEdit::Restore {
                input,
                source_id,
                index,
                paused,
            } => {
                if source_id.is_nil() || index > 64 {
                    return Err(QueueError::Invalid);
                }
                if self.preparing.is_some() {
                    return Err(QueueError::Busy);
                }
                if self.inputs.iter().any(|item| item.id == source_id) {
                    return Err(QueueError::Conflict);
                }
                self.change(QueueEdit::Add(input))?;
                let input = self.inputs.pop().ok_or(QueueError::Invalid)?;
                if paused {
                    self.paused_inputs.insert(input.id);
                }
                self.inputs.insert(index.min(self.inputs.len()), input);
            }
            QueueEdit::Add(input) => {
                validate(&input)?;
                if self.inputs.iter().any(|item| item.id == input.id) {
                    return Err(QueueError::Conflict);
                }
                if self.inputs.len() >= 64 {
                    return Err(QueueError::Capacity);
                }
                self.inputs.push(input);
            }
            QueueEdit::Update {
                id,
                text,
                user_input,
            } => {
                self.editable(id)?;
                let index = self.index(id)?;
                let input = QueuedInput {
                    origin: self.inputs[index].origin.clone(),
                    id,
                    text,
                    user_input,
                };
                validate(&input)?;
                self.inputs[index] = input;
            }
            QueueEdit::Remove(id) => {
                self.editable(id)?;
                let index = self.index(id)?;
                self.inputs.remove(index);
                self.paused_inputs.remove(&id);
            }
            QueueEdit::Reorder(ids) => {
                if self.preparing.is_some() {
                    return Err(QueueError::Busy);
                }
                if ids.len() != self.inputs.len()
                    || ids.iter().collect::<HashSet<_>>().len() != ids.len()
                {
                    return Err(QueueError::Invalid);
                }
                self.inputs = ids
                    .into_iter()
                    .map(|id| self.index(id).map(|i| self.inputs[i].clone()))
                    .collect::<Result<_, _>>()?;
            }
            QueueEdit::Pause => self.paused = true,
            QueueEdit::PauseInput(id) => {
                self.editable(id)?;
                self.index(id)?;
                self.paused_inputs.insert(id);
            }
            QueueEdit::ResumeInput(id) => {
                if self.preparing.is_some() {
                    return Err(QueueError::Busy);
                }
                self.editable(id)?;
                self.index(id)?;
                if self.paused {
                    // Resuming one held entry must not resume all entries after stop/recovery.
                    self.paused_inputs
                        .extend(self.inputs.iter().map(|input| input.id));
                    self.paused = false;
                }
                self.paused_inputs.remove(&id);
            }
            QueueEdit::Resume => {
                // A persisted preparing head belongs to an in-flight preview or
                // recovery check. Do not let a second owner resume the queue
                // behind that claim; release or admission must settle it first.
                if self.preparing.is_some() {
                    return Err(QueueError::Busy);
                }
                self.paused = false;
            }
            QueueEdit::Prepare(id) => {
                if self.paused {
                    return Err(QueueError::Paused);
                }
                if self.preparing.is_some() {
                    return Err(QueueError::Busy);
                }
                if self.input_paused(id) {
                    return Err(QueueError::Paused);
                }
                if self.next_input().map(|item| item.id) != Some(id) {
                    return Err(QueueError::Conflict);
                }
                self.preparing = Some(id);
            }
            QueueEdit::Admitted(id) | QueueEdit::Release(id) => {
                if self.preparing != Some(id) {
                    return Err(QueueError::Conflict);
                }
                if matches!(edit, QueueEdit::Admitted(_)) {
                    let index = self.index(id)?;
                    self.inputs.remove(index);
                    self.paused_inputs.remove(&id);
                } else {
                    self.paused = true;
                }
                self.preparing = None;
            }
        }
        Ok(())
    }

    fn index(&self, id: Uuid) -> Result<usize, QueueError> {
        self.inputs
            .iter()
            .position(|item| item.id == id)
            .ok_or(QueueError::Conflict)
    }

    fn editable(&self, id: Uuid) -> Result<(), QueueError> {
        if self.preparing == Some(id) {
            return Err(QueueError::Busy);
        }
        Ok(())
    }
}

fn validate(input: &QueuedInput) -> Result<(), QueueError> {
    crate::user_input::validate(&input.user_input, &input.text).map_err(|_| QueueError::Invalid)?;
    if input.id.is_nil() || input.text.trim().is_empty() || input.text.len() > 65_536 {
        return Err(QueueError::Invalid);
    }
    if input
        .origin
        .as_ref()
        .is_some_and(|origin| Uuid::parse_str(&origin.resource_id).map_or(true, |id| id.is_nil()))
    {
        return Err(QueueError::Invalid);
    }
    Ok(())
}
