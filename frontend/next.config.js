const nextConfig = {
  async rewrites() {
    return [
      { source: '/api/:path*', destination: 'http://nginx:80/api/:path*' },
      { source: '/ws/:path*', destination: 'http://nginx:80/ws/:path*' },
    ]
  }
}
module.exports = nextConfig
