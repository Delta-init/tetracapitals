import { ObjectId } from "mongodb";

/**
 * Convert a string id supplied by the frontend into an ObjectId for query.
 * Falls back to a no-op match (matches nothing) if the string isn't a valid ObjectId.
 */
export function toObjectId(id: string): ObjectId | null {
  if (!id || typeof id !== "string") return null;
  if (!ObjectId.isValid(id)) return null;
  return new ObjectId(id);
}

/**
 * Normalize a Mongo doc for JSON: replace _id with id (string), strip _id.
 */
export function serialize<T extends { _id?: ObjectId }>(doc: T | null): any {
  if (!doc) return null;
  const { _id, ...rest } = doc as any;
  return { id: _id?.toString(), ...rest };
}

export function serializeMany<T extends { _id?: ObjectId }>(docs: T[]): any[] {
  return docs.map((d) => serialize(d));
}

export function newId(): string {
  return new ObjectId().toString();
}
