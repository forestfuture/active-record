// Foreign keys for associations: the one declared, or inferred by Rails' naming convention.
import type {
  AssociationDeclaration,
  AssociationDefinition,
  AssociationKind,
} from "./associations.ts";
import { camelize, underscore } from "./naming.ts";

/** Where an inferred foreign key came from, for the error when it isn't declared. */
export interface Inference {
  source: "associationName" | "modelName";
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
          ? inferForeignKey(declaration.kind, name, modelName)
          : { foreignKey: declaration.foreignKey }),
      },
    ]),
  );
}

/**
 * A polymorphic belongsTo's declaration with its type attribute (#60): the one passed, or its
 * name + `Type` (`commentable` → `commentableType`), as its key is its name + `Id`.
 */
function withForeignType(
  name: string,
  declaration: AssociationDeclaration,
): AssociationDeclaration {
  if (declaration.targets === undefined) return declaration;
  return { ...declaration, foreignType: declaration.foreignType ?? `${name}Type` };
}

/**
 * A belongsTo's name + `Id` (`author` → `authorId`); for a hasMany or hasOne, the owner's
 * `modelName` + `Id`, through `underscore` (`User` → `userId`, `APIKey` → `apiKeyId`).
 */
function inferForeignKey(
  kind: AssociationKind,
  associationName: string,
  modelName: string,
): { foreignKey: string; inferredFrom: Inference } {
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
  return `inferred from the modelName ${name}; declare it, or pass foreignKey (and set static modelName if your bundler renames classes)`;
}
