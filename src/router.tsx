import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { esErrorDeSesion } from "./hooks/useGuardianDeSesion";

export const getRouter = () => {
  const queryClient = new QueryClient({
    // Un fallo por sesion caducada se avisa al guardian (que lleva al login)
    // en vez de dejar la pantalla a medias. Aqui esta el enganche central:
    // cualquier query que falle lo pasa por aqui.
    queryCache: new QueryCache({
      onError: (error) => {
        if (!esErrorDeSesion(error)) return;
        if (typeof window === "undefined") return;
        window.dispatchEvent(new CustomEvent("deal-maker:error-sesion", { detail: { error } }));
      },
    }),
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
