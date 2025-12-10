import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["recharts"],
  // Configuração do Turbopack (Next.js 16+)
  // Define o diretório raiz do workspace para evitar avisos sobre múltiplos lockfiles
  turbopack: {
    root: __dirname,
  },
  // Manter webpack config para builds de produção (quando não usar Turbopack)
  webpack: (config, { isServer }) => {
    // Resolver problemas com es-toolkit usado pelo recharts
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
      };
    }
    
    // Resolver módulos do es-toolkit - corrigir caminhos relativos quebrados
    config.resolve.alias = {
      ...config.resolve.alias,
    };
    
    // Adicionar extensões .js para resolução de módulos
    config.resolve.extensions = [
      ...(config.resolve.extensions || []),
      '.js',
      '.jsx',
      '.ts',
      '.tsx',
    ];
    
    // Ignorar avisos de módulos opcionais do es-toolkit
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      {
        module: /node_modules\/es-toolkit/,
      },
    ];
    
    return config;
  },
};

export default nextConfig;
