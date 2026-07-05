import type { Metadata } from "next";
import type { ReactElement } from "react";
import type { Locale } from "@/lib/i18n";
import { resolveLocaleSegment } from "./routing";

type MaybePromise<T> = T | Promise<T>;
type EmptyRouteParams = Record<string, never>;

export type RouteParams = Record<string, string>;

export type RoutePageContext<Params extends RouteParams = EmptyRouteParams> = {
  locale: Locale;
  params: Params;
};

type RoutePageConfig<Params extends RouteParams> = {
  generateMetadata: (context: RoutePageContext<Params>) => MaybePromise<Metadata>;
  render: (context: RoutePageContext<Params>) => MaybePromise<ReactElement>;
};

type EnglishRouteProps<Params extends RouteParams> = {
  params?: Promise<Params>;
};

type LocalizedRouteProps<Params extends RouteParams> = {
  params: Promise<Params & { locale: string }>;
};

export function createEnglishPage<Params extends RouteParams = EmptyRouteParams>(config: RoutePageConfig<Params>) {
  return {
    generateMetadata: async (props?: EnglishRouteProps<Params>): Promise<Metadata> =>
      config.generateMetadata({ locale: "en", params: await resolveEnglishParams(props?.params) }),
    Page: async (props?: EnglishRouteProps<Params>): Promise<ReactElement> =>
      config.render({ locale: "en", params: await resolveEnglishParams(props?.params) }),
  };
}

export function createLocalizedPage<Params extends RouteParams = EmptyRouteParams>(config: RoutePageConfig<Params>) {
  return {
    generateMetadata: async ({ params }: LocalizedRouteProps<Params>): Promise<Metadata> =>
      config.generateMetadata(await resolveLocalizedRouteContext(params)),
    Page: async ({ params }: LocalizedRouteProps<Params>): Promise<ReactElement> =>
      config.render(await resolveLocalizedRouteContext(params)),
  };
}

async function resolveEnglishParams<Params extends RouteParams>(params?: Promise<Params>): Promise<Params> {
  return params ? await params : ({} as Params);
}

async function resolveLocalizedRouteContext<Params extends RouteParams>(
  params: Promise<Params & { locale: string }>,
): Promise<RoutePageContext<Params>> {
  const { locale, ...routeParams } = await params;
  return { locale: resolveLocaleSegment(locale), params: routeParams as unknown as Params };
}
