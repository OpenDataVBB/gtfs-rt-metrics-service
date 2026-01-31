# gtfs-rt-metrics-service

**Consumes a [GTFS Realtime (GTFS-RT)](https://gtfs.org/documentation/realtime/reference/) feed and serves metrics about it via HTTP.**

![ISC-licensed](https://img.shields.io/github/license/OpenDataVBB/gtfs-rt-metrics-service.svg)


## Installation

```shell
npm install -g OpenDataVBB/gtfs-rt-metrics-service
```

This project uses [duckdb-gtfs-importer](https://github.com/OpenDataVBB/duckdb-gtfs-importer) to import the configured GTFS dataset. For running it using Docker (default), you need the [Docker CLI](https://docs.docker.com/reference/cli/docker/) installed. When running duckdb-gtfs-import without Docker, make sure you have its dependencies installed.


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
    --matching-time-buffer-before Match GTFS-RT entities with Schedule trip instances
                                  that have been (or were) active earlier than now.
                                  Default: $GTFS_RT_MATCHING_TIME_BUFFER_BEFORE, otherwise 10m.
    --matching-time-buffer-after  Match GTFS-RT entities with Schedule trip instances
                                  that will be (or are) active later than now.
                                  Default: $GTFS_RT_MATCHING_TIME_BUFFER_AFTER, otherwise 10m.
Examples:
    serve-gtfs-rt-from-nats --port 1234 'https://example.org/gtfs-rt.pb'
```

### metrics example

The following example was generated using the [VBB GTFS-RT feed](https://production.gtfsrt.vbb.de):

<details>
<summary>metrics</summary>

```
# HELP gtfs_rt_feed_size_raw_bytes size of the final GTFS-RT feed (uncompressed)
# TYPE gtfs_rt_feed_size_raw_bytes gauge
gtfs_rt_feed_size_raw_bytes 9505050

# HELP gtfs_rt_fetch_time_seconds time needed to fetch the GTFS-RT feed
# TYPE gtfs_rt_fetch_time_seconds summary
gtfs_rt_fetch_time_seconds{quantile="0.01"} 0.6924725420000032
gtfs_rt_fetch_time_seconds{quantile="0.05"} 0.6924725420000032
gtfs_rt_fetch_time_seconds{quantile="0.5"} 0.7331842914999871
gtfs_rt_fetch_time_seconds{quantile="0.9"} 0.8823821249999948
gtfs_rt_fetch_time_seconds{quantile="0.95"} 0.9234764999999897
gtfs_rt_fetch_time_seconds{quantile="0.99"} 0.9234764999999897
gtfs_rt_fetch_time_seconds{quantile="0.999"} 0.9234764999999897
gtfs_rt_fetch_time_seconds_sum 7.668760039999933
gtfs_rt_fetch_time_seconds_count 10

# HELP gtfs_rt_processing_time_seconds time needed to process the GTFS-RT feed
# TYPE gtfs_rt_processing_time_seconds summary
gtfs_rt_processing_time_seconds{quantile="0.01"} 0.4953776249999937
gtfs_rt_processing_time_seconds{quantile="0.05"} 0.4953776249999937
gtfs_rt_processing_time_seconds{quantile="0.5"} 0.5160944789999997
gtfs_rt_processing_time_seconds{quantile="0.9"} 0.6124483120000077
gtfs_rt_processing_time_seconds{quantile="0.95"} 0.6321638330000132
gtfs_rt_processing_time_seconds{quantile="0.99"} 0.6321638330000132
gtfs_rt_processing_time_seconds{quantile="0.999"} 0.6321638330000132
gtfs_rt_processing_time_seconds_sum 5.398243622999922
gtfs_rt_processing_time_seconds_count 10

# HELP gtfs_rt_feed_fetches_total how often the GTFS-RT feed has been fetched & processed
# TYPE gtfs_rt_feed_fetches_total counter
gtfs_rt_feed_fetches_total{status="success_changed"} 10

# HELP gtfs_rt_feed_timestamp_seconds GTFS-RT FeedHeader.timestamp, if present
# TYPE gtfs_rt_feed_timestamp_seconds gauge
gtfs_rt_feed_timestamp_seconds 1767894747

# HELP gtfs_rt_feed_entities_total number of entities in the GTFS-RT feed
# TYPE gtfs_rt_feed_entities_total gauge
gtfs_rt_feed_entities_total 8529

# HELP gtfs_rt_items_total number of items (FeedEntity children) in the GTFS-RT feed, by their matching result with the Schedule feed
# TYPE gtfs_rt_items_total gauge
gtfs_rt_items_total{kind="tu",route_id_n="23944",matched="1"} 11
gtfs_rt_items_total{kind="tu",route_id_n="23945",matched="1"} 22
gtfs_rt_items_total{kind="tu",route_id_n="10141",matched="1"} 129
gtfs_rt_items_total{kind="tu",route_id_n="23944",matched="0"} 2
gtfs_rt_items_total{kind="tu",route_id_n="7362_",matched="0"} 5
# …

# HELP gtfs_rt_schedule_trip_instances_total number of trip instances in the Schedule feed, and if they have >=1 corresponding GTFS-RT items
# TYPE gtfs_rt_schedule_trip_instances_total gauge
gtfs_rt_schedule_trip_instances_total{agency_id_n="32",route_type_n="700",route_id_n="5233_",matched="0"} 2
gtfs_rt_schedule_trip_instances_total{agency_id_n="32",route_type_n="700",route_id_n="5236_",matched="0"} 1
gtfs_rt_schedule_trip_instances_total{agency_id_n="32",route_type_n="700",route_id_n="5238_",matched="0"} 2
gtfs_rt_schedule_trip_instances_total{agency_id_n="32",route_type_n="700",route_id_n="5238_",matched="1"} 2
gtfs_rt_schedule_trip_instances_total{agency_id_n="32",route_type_n="700",route_id_n="5239_",matched="0"} 2
gtfs_rt_schedule_trip_instances_total{agency_id_n="32",route_type_n="700",route_id_n="5248_",matched="0"} 2
gtfs_rt_schedule_trip_instances_total{agency_id_n="32",route_type_n="700",route_id_n="5249_",matched="0"} 5
gtfs_rt_schedule_trip_instances_total{agency_id_n="32",route_type_n="700",route_id_n="25354",matched="1"} 2
gtfs_rt_schedule_trip_instances_total{agency_id_n="32",route_type_n="3",route_id_n="13543",matched="1"} 1
# …

# HELP gtfs_rt_feed_items_ages_seconds age (time until now) of each item (FeedEntity children) in the GTFS-RT feed that has a .timestamp
# TYPE gtfs_rt_feed_items_ages_seconds summary
gtfs_rt_feed_items_ages_seconds{quantile="0.01",kind="tu",agency_id_n="?",route_type_n="?",route_id_n="23944",matched="1"} 43073.176
gtfs_rt_feed_items_ages_seconds{quantile="0.05",kind="tu",agency_id_n="?",route_type_n="?",route_id_n="23944",matched="1"} 43150.476
gtfs_rt_feed_items_ages_seconds{quantile="0.5",kind="tu",agency_id_n="?",route_type_n="?",route_id_n="23944",matched="1"} 44625.176
gtfs_rt_feed_items_ages_seconds{quantile="0.9",kind="tu",agency_id_n="?",route_type_n="?",route_id_n="23944",matched="1"} 69250.50933333335
gtfs_rt_feed_items_ages_seconds{quantile="0.95",kind="tu",agency_id_n="?",route_type_n="?",route_id_n="23944",matched="1"} 71009.176
gtfs_rt_feed_items_ages_seconds{quantile="0.99",kind="tu",agency_id_n="?",route_type_n="?",route_id_n="23944",matched="1"} 71009.176
gtfs_rt_feed_items_ages_seconds{quantile="0.999",kind="tu",agency_id_n="?",route_type_n="?",route_id_n="23944",matched="1"} 71009.176
gtfs_rt_feed_items_ages_seconds_sum{kind="tu",agency_id_n="?",route_type_n="?",route_id_n="23944",matched="1"} 542085.9359999999
gtfs_rt_feed_items_ages_seconds_count{kind="tu",agency_id_n="?",route_type_n="?",route_id_n="23944",matched="1"} 11
gtfs_rt_feed_items_ages_seconds{quantile="0.01",kind="tu",agency_id_n="731",route_type_n="100",route_id_n="16345",matched="1"} 34500.176
gtfs_rt_feed_items_ages_seconds{quantile="0.05",kind="tu",agency_id_n="731",route_type_n="100",route_id_n="16345",matched="1"} 34500.176
gtfs_rt_feed_items_ages_seconds{quantile="0.5",kind="tu",agency_id_n="731",route_type_n="100",route_id_n="16345",matched="1"} 44626.176
gtfs_rt_feed_items_ages_seconds{quantile="0.9",kind="tu",agency_id_n="731",route_type_n="100",route_id_n="16345",matched="1"} 44628.176
gtfs_rt_feed_items_ages_seconds{quantile="0.95",kind="tu",agency_id_n="731",route_type_n="100",route_id_n="16345",matched="1"} 44628.176
gtfs_rt_feed_items_ages_seconds{quantile="0.99",kind="tu",agency_id_n="731",route_type_n="100",route_id_n="16345",matched="1"} 44628.176
gtfs_rt_feed_items_ages_seconds{quantile="0.999",kind="tu",agency_id_n="731",route_type_n="100",route_id_n="16345",matched="1"} 44628.176
gtfs_rt_feed_items_ages_seconds_sum{kind="tu",agency_id_n="731",route_type_n="100",route_id_n="16345",matched="1"} 123754.52799999999
gtfs_rt_feed_items_ages_seconds_count{kind="tu",agency_id_n="731",route_type_n="100",route_id_n="16345",matched="1"} 3
# …

# HELP gtfs_rt_matching_time_buffer_before_seconds Amount of time that Schedule trip instances can be in the past while still being matched with GTFS-RT entities.
# TYPE gtfs_rt_matching_time_buffer_before_seconds gauge
gtfs_rt_matching_time_buffer_before_seconds 600

# HELP gtfs_rt_matching_time_buffer_after_seconds Amount of time that Schedule trip instances can be in the future while still being matched with GTFS-RT entities.
# TYPE gtfs_rt_matching_time_buffer_after_seconds gauge
gtfs_rt_matching_time_buffer_after_seconds 600
```

</details>


## Related

- [`gtfs-rt-bindings`](https://github.com/derhuerst/gtfs-rt-bindings) – Parse and serialize GTFS Realtime data encoded as protocol buffers. (third-party)
- [`gtfs-realtime-bindings`](https://npmjs.com/package/gtfs-realtime-bindings) – Javascript classes generated from the GTFS-realtime protocol buffer specification. (official)


## Contributing

If you have a question or need support using `gtfs-rt-metrics-service`, please double-check your code and setup first. If you think you have found a bug or want to propose a feature, use [the issues page](https://github.com/OpenDataVBB/gtfs-rt-metrics-service/issues).
