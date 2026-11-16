---
"@forestfuture/active-record": patch
---

Validation options (#343). `validates` takes `unless: (record) => boolean`, the opposite of `if`; `allowBlank`, which skips null and a string that's only whitespace; and `strict: true`, which throws `StrictValidationFailed` with the failure's full message ("Email can't be blank") instead of adding an error, or `strict: SomeError` to throw that class. `this.validatesAssociated("posts")` validates an association's records with their owner, loading it if it isn't loaded: an invalid one makes the owner invalid ("Posts is invalid"). It takes `if`, `unless`, `message`, and `strict`. A record already being validated counts as valid, so declaring it on both sides of an association ends, and a record autosave validates too is validated once.
