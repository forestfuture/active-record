// The class `Model.define({...})` builds (ADR-0007): its attributes and aliases (#509) as declared,
// their accessors, and its enums' methods, on the base class it's called on.
import { aliasesIn, isAlias, type DefinedSpecs } from "./attribute-aliases.ts";
import { defineEnumMethods, defineEnumStatics } from "./enum-methods.ts";
import { defineAttributeAccessors } from "./generated-model.ts";
import {
  define,
  type AttributeDefinition,
  type AttributeSpec,
  type AttributeSpecs,
  type DeclaredAttributes,
} from "./metadata.ts";
import type { BaseClass, Model, ModelBaseFor } from "./model.ts";
import { inferTableNames } from "./table-names.ts";
import { defineSecureTokenMethods } from "./secure-tokens.ts";
import {
  defineSecurePasswordMethods,
  rejectMissingDigests,
  withSecurePasswords,
  type WithSecurePasswords,
} from "./secure-passwords.ts";

/**
 * `S` as attribute specs: itself, or when it isn't (a spec that's a compile error), widened, so
 * `define` still gives a class to extend and the error stays on the spec.
 */
export type SpecsOrWidened<S> = S extends AttributeSpecs ? S : S & AttributeSpecs;

/** `Model.define({...})` on `base`: a class with the attributes' accessors, extending `base`. */
export function defineModel<A extends DeclaredAttributes, B extends BaseClass>(
  specs: DeclaredAttributes,
  base: B,
): ModelBaseFor<SpecsOrWidened<DefinedSpecs<WithSecurePasswords<A>>>, B> {
  const Parent = base as unknown as typeof Model;
  const declared = withSecurePasswords("", specs);
  const definitions = new Map(
    Object.entries(declared).flatMap(([name, spec]) =>
      isAlias(spec) ? [] : [[name, define(name, spec as AttributeSpec)] as const],
    ),
  );
  const aliases = aliasesIn("", declared, definitions);
  rejectMissingDigests("", definitions);
  class DefinedModel extends Parent {
    static override attributeDefinitions: ReadonlyMap<string, AttributeDefinition> = definitions;
    static override attributeAliases: ReadonlyMap<string, string> = aliases;
  }
  inferTableNames(DefinedModel);
  defineAttributeAccessors(DefinedModel.prototype, Object.keys(declared));
  defineEnumMethods(DefinedModel.prototype, DefinedModel.attributeDefinitions);
  defineEnumStatics(DefinedModel, DefinedModel.attributeDefinitions);
  defineSecurePasswordMethods(DefinedModel.prototype, DefinedModel.attributeDefinitions);
  defineSecureTokenMethods(DefinedModel.prototype, DefinedModel.attributeDefinitions);
  return DefinedModel as never;
}
