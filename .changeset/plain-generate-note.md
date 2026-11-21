---
"@forestfuture/active-record": patch
---

`active-record generate model` with a plural name now notes only the singular Model it makes: `line_items looks plural, so the Model is LineItem` (#511). The app base class that `init` and `schema` write describes itself and its filter defaults without naming another framework.
