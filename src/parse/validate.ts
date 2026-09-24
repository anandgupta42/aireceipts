/** Fields interpreted by transcript adapters. Unknown fields remain forward compatible. */
export type FieldType = "string" | "number" | "integer" | "boolean" | "object" | "array" | "stringOrNumber" | "stringOrArray" | "stringOrObject" | "numberOrObject" | "any";
export interface FieldRule {
  type: FieldType;
  required?: boolean;
  fields?: FieldTable;
  elements?: FieldRule;
}
export type FieldTable = Readonly<Record<string, FieldRule>>;

export function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validField(value: unknown, rule: FieldRule): boolean {
  if (value === undefined) return !rule.required;
  if (value === null) return rule.type === "any";
  const matches = (() => {
    switch (rule.type) {
      case "string": return typeof value === "string";
      case "number": return typeof value === "number" && Number.isFinite(value);
      case "integer": return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
      case "boolean": return typeof value === "boolean";
      case "object": return plainObject(value);
      case "array": return Array.isArray(value);
      case "stringOrNumber": return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
      case "stringOrArray": return typeof value === "string" || Array.isArray(value);
      case "stringOrObject": return typeof value === "string" || plainObject(value);
      case "numberOrObject": return (typeof value === "number" && Number.isFinite(value)) || plainObject(value);
      case "any": return true;
    }
  })();
  if (!matches) return false;
  if (rule.fields && plainObject(value) && !validFields(value, rule.fields)) return false;
  if (rule.elements && Array.isArray(value) && !value.every((element) => validField(element, rule.elements!))) return false;
  return true;
}

export function validFields(value: unknown, table: FieldTable): boolean {
  if (!plainObject(value)) return false;
  return Object.entries(table).every(([name, rule]) => validField(value[name], rule));
}
