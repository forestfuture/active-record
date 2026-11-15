// `defineSchema`: a generated schema, whose Models' enum scopes are statics from the start (#340).
import { ancestors } from "./ancestors.ts";
import { readyModel } from "./associations.ts";
import type { DatabaseSchema } from "./generated-model.ts";
import { Model, type ModelClass } from "./model.ts";
import { isReservedScopeName } from "./scoped-relation.ts";
import { modelNameOf, ownValueSetter } from "./table-names.ts";

// Module-level, but not request state (ADR-0003): the scope names every schema loaded has listed.
const listed = new Set<string>();

/**
 * A generated schema, as `schema.ts` declares it: `export const schema = defineSchema({ … })`.
 * A generated Model's attributes are settled when it's first used, so its enum scopes would
 * only appear then; `Post.published()` is often that first use. So each scope the schema lists
 * is a static of every Model now: on a Model it's listed for, reading it readies the Model,
 * which defines the scope on it; on any other, it's `undefined`.
 */
export function defineSchema<const S extends DatabaseSchema>(schema: S): S {
  for (const names of Object.values(schema.enumScopes ?? {})) {
    for (const name of names) listScope(name);
  }
  return schema;
}

function listScope(name: string): void {
  // Never in place of what every class has: a Relation method, a Model static, or a Function's.
  if (listed.has(name) || isReservedScopeName(name) || name in Model) return;
  listed.add(name);
  Object.defineProperty(Model, name, {
    configurable: true,
    get(this: ModelClass) {
      return enumScopeOf(this, name);
    },
    set: ownValueSetter(name),
  });
}

/** The scope `name` of `model`, once it's ready, if its schema lists it; else `undefined`. */
function enumScopeOf(model: ModelClass, name: string): unknown {
  if (!isListedFor(model, name)) return undefined;
  readyModel(model);
  // The scope readying defined, on the Model or a class it extends: never this getter again.
  for (const each of ancestors(model)) {
    if (each === Model) break;
    const found = Object.getOwnPropertyDescriptor(each, name);
    if (found !== undefined) return found.value;
  }
  return undefined;
}

/**
 * Whether the schema `model`'s base holds lists `name` among the enum scopes of `model`, or of a
 * class it extends: a subclass of a generated Model has its scopes, by the Model's `modelName`.
 */
function isListedFor(model: ModelClass, name: string): boolean {
  const holder = ancestors(model).find((each) => Object.hasOwn(each, "schema")) as
    | { schema?: DatabaseSchema }
    | undefined;
  const scopes = holder?.schema?.enumScopes;
  if (scopes === undefined) return false;
  return ancestors(model)
    .filter((each) => each !== holder)
    .some((each) => {
      const modelName = modelNameOf(each);
      return Object.hasOwn(scopes, modelName) && scopes[modelName]!.includes(name);
    });
}
