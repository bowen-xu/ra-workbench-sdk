# HBS reference captures

`hbs-reference-session-traces-baseline-2026-10-23.json` is the existing independent
reference capture consumed by `HbsReferenceParity.test.ts`. It contains only
synthetic text and expected states, including the user-confirmed red-baseline and
ordinary-baseline CAS/ACK corrections. Its embedded `reference` and `sourceHashes`
retain the original provenance.

The file was moved byte-for-byte out of the ignored `docs/testing/fixtures/`
location so a clean checkout can type-check and execute the existing parity
contract. Expected results were not regenerated from the application.
