-- todo: test this using sample-gtfs-feed and this query:
-- SELECT *
-- FROM trips_active_periods_by_date
-- WHERE t_active_from <= '2019-06-29T08:30:00+02' AND t_active_until >= '2019-06-29T08:30:00+02';

-- todo: use materialized view once DuckDB supports that
CREATE OR REPLACE TABLE trips_active_periods_by_date AS
WITH stop_times_based AS NOT MATERIALIZED (
	SELECT
		DISTINCT ON (trip_id)
		stop_times.*
	FROM (
		SELECT
			trip_id,
			first_value(coalesce(arrival_time, departure_time)) OVER (PARTITION BY trip_id ORDER BY stop_sequence_consec ASC) AS active_from,
			first_value(coalesce(departure_time, arrival_time)) OVER (PARTITION BY trip_id ORDER BY stop_sequence_consec DESC) AS active_until,
			-- copied from gtfs-via-duckdb
			coalesce(
				first_value(departure_time) OVER (PARTITION BY trip_id ORDER BY stop_sequence_consec ASC),
				first_value(arrival_time) OVER (PARTITION BY trip_id ORDER BY stop_sequence_consec ASC)
			) AS trip_start_time
		FROM stop_times
	) stop_times
)

-- SELECT *
-- FROM (

SELECT
	"date",
	trips.route_id,
	trips_start_end.*
	EXCLUDE (
		active_from,
		active_until,
	),
	direction_id,
	-- todo: is this correct with the `frequencies.exact_times = 'schedule_based'` filtering below?
	(
		(first_value(frequencies_row) OVER (PARTITION BY "date", trips.trip_id ORDER BY frequencies_row DESC)) > -1
	) AS trip_has_frequencies,
	has_only_1_service_date AS trip_has_only_1_service_date,
	-- adapted from gtfs-via-duckdb
	(
		make_timestamptz(
			date_part('year', "date")::int,
			date_part('month', "date")::int,
			date_part('day', "date")::int,
			12, 0, 0,
			agency.agency_timezone
		)
		- INTERVAL '12 hours'
		+ active_from
	) AS t_active_from,
	(
		make_timestamptz(
			date_part('year', "date")::int,
			date_part('month', "date")::int,
			date_part('day', "date")::int,
			12, 0, 0,
			agency.agency_timezone
		)
		- INTERVAL '12 hours'
		+ active_until
	) AS t_active_until
FROM (
	-- adapted from gtfs-via-duckdb
	SELECT
		*,
		-1 AS frequencies_row,
		-1 AS frequencies_it
	FROM stop_times_based
	UNION ALL BY NAME
	SELECT
		*,
		row_number() OVER (PARTITION BY trip_id, frequencies_row ORDER BY active_from ASC) AS frequencies_it
	FROM (
		SELECT
			stop_times_based.*
			REPLACE (
				-- As of DuckDB v1.4.2, `generate_series(INTERVAL, INTERVAL, INTERVAL)` doesn't exist, so we have to temporarily cast to BIGINT :/
				INTERVAL (unnest(generate_series(
					epoch(start_time)::BIGINT,
					epoch(end_time)::BIGINT,
					headway_secs
				))) seconds AS trip_start_time,
				INTERVAL (unnest(generate_series(
					epoch(active_from - trip_start_time + start_time)::BIGINT,
					epoch(active_from - trip_start_time + end_time)::BIGINT,
					headway_secs
				))) SECONDS AS active_from,
				INTERVAL (unnest(generate_series(
					epoch(active_until - trip_start_time + start_time)::BIGINT,
					epoch(active_until - trip_start_time + end_time)::BIGINT,
					headway_secs
				))) seconds AS active_until,
			),
			frequencies.frequencies_row AS frequencies_row
		FROM stop_times_based
		JOIN frequencies ON frequencies.trip_id = stop_times_based.trip_id
		WHERE frequencies.exact_times = 'schedule_based' -- todo: is this correct?
	) frequencies_based
) trips_start_end
JOIN trips ON trips.trip_id = trips_start_end.trip_id
JOIN routes ON routes.route_id = trips.route_id
JOIN agency ON agency.agency_id = routes.agency_id
JOIN service_days ON service_days.service_id = trips.service_id
JOIN (
	SELECT
		service_id,
		count("date") = 1 AS has_only_1_service_date
	FROM service_days
	GROUP BY service_id
) sd ON sd.service_id = service_days.service_id
ORDER BY "date", trips_start_end.trip_id, frequencies_row, frequencies_it

-- ) t
-- WHERE True
-- -- AND trip_id = 'b-downtown-on-working-days'
-- AND (
-- 	"date" = '2019-06-29'
-- 	-- OR "date" = '2019-07-01'
-- )
;

-- todo: as of DuckDB v1.4.2, doesn't seem to be used
CREATE INDEX trips_active_periods_by_date_t_start_t_end ON trips_active_periods_by_date(t_active_from, t_active_until);
