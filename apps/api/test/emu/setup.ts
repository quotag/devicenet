// Corporate HTTP proxies break gRPC/fetch to the local emulators: drop them for emulator tests.
for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'grpc_proxy', 'GRPC_PROXY']) {
  delete process.env[k];
}
process.env.no_proxy = '127.0.0.1,localhost';
process.env.NO_PROXY = '127.0.0.1,localhost';
