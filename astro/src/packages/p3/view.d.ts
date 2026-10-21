declare module "astro-p3:categories" {
  export const CategoriesPageView: typeof import("../../../../web/app/_localized/categories").CategoriesPageView;
  export const CategoryDimensionPageView: typeof import("../../../../web/app/_localized/categories").CategoryDimensionPageView;
  export const CategoryDetailPageView: typeof import("../../../../web/app/_localized/categories").CategoryDetailPageView;
  export const generateCategoriesMetadata: typeof import("../../../../web/app/_localized/categories").generateCategoriesMetadata;
  export const generateCategoryDimensionMetadata: typeof import("../../../../web/app/_localized/categories").generateCategoryDimensionMetadata;
  export const generateCategoryDetailMetadataForLocale: typeof import("../../../../web/app/_localized/categories").generateCategoryDetailMetadataForLocale;
}
