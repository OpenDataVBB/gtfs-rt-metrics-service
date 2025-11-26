# gtfs-rt-metrics-service

**Consumes a [GTFS Realtime (GTFS-RT)](https://gtfs.org/documentation/realtime/reference/) feed and serves metrics about it via HTTP.**

![ISC-licensed](https://img.shields.io/github/license/OpenDataVBB/gtfs-rt-metrics-service.svg)


## Installation

```shell
npm install -g OpenDataVBB/gtfs-rt-metrics-service
```


## Getting Started

```shell
# todo
```


## Usage

```
Usage:
    serve-gtfs-rt-from-nats [options] -- <gtfs-rt-url> ...
Options:
    --port                    -p  Port to serve the metrics on.
                                  Default: $PORT, otherwise 3000
    --fetch-interval          -i  How often to fetch the GTFS-RT feed, in seconds.
                                  Default: $GTFS_RT_FETCH_INTERVAL, otherwise 10.
    --user-agent              -a  Which User-Agent header to send when fetching the
                                  feed via HTTP. Default: $USER_AGENT, otherwise
                                  "gtfs-rt-metrics-service $random".
Examples:
    serve-gtfs-rt-from-nats --port 1234 'https://example.org/gtfs-rt.pb'
```


## Related

- [`gtfs-rt-bindings`](https://github.com/derhuerst/gtfs-rt-bindings) – Parse and serialize GTFS Realtime data encoded as protocol buffers. (third-party)
- [`gtfs-realtime-bindings`](https://npmjs.com/package/gtfs-realtime-bindings) – Javascript classes generated from the GTFS-realtime protocol buffer specification. (official)


## Contributing

If you have a question or need support using `gtfs-rt-metrics-service`, please double-check your code and setup first. If you think you have found a bug or want to propose a feature, use [the issues page](https://github.com/OpenDataVBB/gtfs-rt-metrics-service/issues).
