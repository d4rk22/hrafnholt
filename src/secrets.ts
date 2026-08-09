import { readFileSync } from "node:fs";

export class SecretResolutionError extends Error {
  override readonly name = "SecretResolutionError";
}

export type SecretFileReader = (path: string) => string;

function isSet(value: string | undefined): value is string {
  return value !== undefined;
}

function withoutTrailingLineEnding(value: string): string {
  if (value.endsWith("\r\n")) return value.slice(0, -2);
  if (value.endsWith("\n") || value.endsWith("\r")) return value.slice(0, -1);
  return value;
}

export function resolveSecretReferences(
  references: Iterable<string>,
  environment: NodeJS.ProcessEnv = process.env,
  readSecretFile: SecretFileReader = (path) => readFileSync(path, "utf8"),
): ReadonlyMap<string, string> {
  const resolved = new Map<string, string>();
  const fileCache = new Map<string, string>();

  for (const reference of [...new Set(references)].sort()) {
    const direct = environment[reference];
    const fileVariable = `${reference}_FILE`;
    const filePath = environment[fileVariable];

    if (isSet(direct) && isSet(filePath)) {
      throw new SecretResolutionError(
        `Secret ${reference} is configured by both ${reference} and ${fileVariable}`,
      );
    }
    if (!isSet(direct) && !isSet(filePath)) {
      throw new SecretResolutionError(`Secret ${reference} is required but is not configured`);
    }

    let value: string;
    if (isSet(filePath)) {
      if (filePath.length === 0) {
        throw new SecretResolutionError(`Secret ${reference} has an empty ${fileVariable} setting`);
      }
      try {
        let fileValue = fileCache.get(filePath);
        if (fileValue === undefined) {
          fileValue = readSecretFile(filePath);
          fileCache.set(filePath, fileValue);
        }
        value = withoutTrailingLineEnding(fileValue);
      } catch {
        throw new SecretResolutionError(`Secret ${reference} could not be read from ${fileVariable}`);
      }
    } else {
      value = direct!;
    }

    if (value.length === 0) {
      throw new SecretResolutionError(`Secret ${reference} resolved to an empty value`);
    }
    if (value.includes("\0")) {
      throw new SecretResolutionError(`Secret ${reference} contains an unsupported NUL byte`);
    }
    resolved.set(reference, value);
  }

  return resolved;
}

export function requireSecret(secrets: ReadonlyMap<string, string>, reference: string): string {
  const value = secrets.get(reference);
  if (value === undefined) {
    throw new SecretResolutionError(`Secret ${reference} was not resolved for this process`);
  }
  return value;
}
