import type { NextConfig } from "next";

// Cabecalhos de seguranca em todas as rotas. Nao uso CSP restritiva aqui para nao
// quebrar os estilos e scripts do proprio Next; os demais ja cortam os ataques mais comuns.
const cabecalhos = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: cabecalhos }];
  },
};

export default nextConfig;
