export class CategoryNotFound extends Error {}
export function notFound(): never { throw new CategoryNotFound("Category not found"); }
