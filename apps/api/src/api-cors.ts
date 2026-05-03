type CorsEnvironment = {
  AUTH_URL?: string;
  SHADOW_CLOUD_DESKTOP_ORIGIN?: string;
  SHADOW_CLOUD_WEB_URL?: string;
  WEB_PORT?: string;
};

function addOrigin(origins: string[], origin: string | undefined) {
  if (origin && !origins.includes(origin)) {
    origins.push(origin);
  }
}

export function resolveCorsOrigins(environment: CorsEnvironment) {
  const origins: string[] = [];

  addOrigin(origins, environment.SHADOW_CLOUD_WEB_URL);
  addOrigin(origins, environment.AUTH_URL);
  addOrigin(
    origins,
    environment.WEB_PORT
      ? `http://localhost:${environment.WEB_PORT}`
      : undefined,
  );
  addOrigin(origins, environment.SHADOW_CLOUD_DESKTOP_ORIGIN);
  addOrigin(origins, 'http://127.0.0.1:1420');
  addOrigin(origins, 'http://localhost:1420');
  addOrigin(origins, 'http://tauri.localhost');
  addOrigin(origins, 'tauri://localhost');

  return origins;
}

export function resolveCorsOptions(environment: CorsEnvironment) {
  return {
    allowedHeaders: ['authorization', 'content-type'],
    exposedHeaders: ['content-disposition'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    origin: resolveCorsOrigins(environment),
  };
}
