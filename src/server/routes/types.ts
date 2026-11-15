import type { RequestContext } from "../context";

export interface RouteRequest {
  readonly request: Request;
  readonly url: URL;
  readonly context: RequestContext;
}

export interface Route {
  readonly path: string;
  readonly method?: string;
  readonly handler: (request: RouteRequest) => Response | Promise<Response>;
}
