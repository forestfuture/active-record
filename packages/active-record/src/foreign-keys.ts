// Foreign keys for associations: the one declared, or inferred by Rails' naming convention.
import type { AssociationDeclaration, AssociationDefinition } from "./associations.ts";
import { camelize, underscore } from "./naming.ts";

/** Where an inferred foreign key came from, for the error when it isn't declared. */
export interface Inference {
  source: "associationName" | "as" | "modelName";
  name: string;
}

/**
 * Gives each declaration its foreign key: the one passed, or else inferred by Rails'
 * convention, where the association's name and its declaring class are known.
 */
export function withForeignKeys(
  declarations: Record<string, AssociationDeclaration>,
  modelName: string,
): Record<string, AssociationDefinition> {
  return Object.fromEntries(
    Object.entries(declarations).map(([name, declaration]) => [
      name,
      {
        ...withForeignType(name, declaration),
        ...(declaration.foreignKey === undefined
          ? inferForeignKey(declaration, name, modelName)
          : { foreignKey: declaration.foreignKey }),
      },
    ]),
  );
}

/**
 * A polymorphic association's declaration with its type attribute (#60): the one passed, or the
 * polymorphic belongsTo's name + `Type` (`commentable` → `commentableType`), as its key is
 * the name + `Id`. That's the association's own name, or for a hasMany or hasOne its `as`.
 */
function withForeignType(
  name: string,
  declaration: AssociationDeclaration,
): AssociationDeclaration & Pick<AssociationDefinition, "typeInferredFrom"> {
  const polymorphicName = declaration.targets === undefined ? declaration.as : name;
  if (polymorphicName === undefined || declaration.foreignType !== undefined) return declaration;
  return {
    ...declaration,
    foreignType: `${polymorphicName}Type`,
    typeInferredFrom: polymorphicName,
  };
}

/**
 * A belongsTo's name + `Id` (`author` → `authorId`), or for a hasMany or hasOne with `as`,
 * the polymorphic belongsTo's name it gives + `Id` (#60); otherwise for a hasMany or hasOne, the
 * owner's `modelName` + `Id`, through `underscore` (`User` → `userId`, `APIKey` → `apiKeyId`).
 */
function inferForeignKey(
  { kind, as }: AssociationDeclaration,
  associationName: string,
  modelName: string,
): { foreignKey: string; inferredFrom: Inference } {
  if (as !== undefined) return { foreignKey: `${as}Id`, inferredFrom: { source: "as", name: as } };
  return kind === "belongsTo"
    ? {
        foreignKey: `${associationName}Id`,
        inferredFrom: { source: "associationName", name: associationName },
      }
    : {
        foreignKey: `${camelize(underscore(modelName))}Id`,
        inferredFrom: { source: "modelName", name: modelName },
      };
}

/** Why an inferred key is missing, and what to do about it. */
export function inferenceHint({ source, name }: Inference): string {
  if (source === "associationName") {
    return `inferred from the association name ${name}; declare it, or pass foreignKey`;
  }
  if (source === "as") return `inferred from as: "${name}"; declare it, or pass foreignKey`;
  return `inferred from the modelName ${name}; declare it, or pass foreignKey (and set static modelName if your bundler renames classes)`;
}
