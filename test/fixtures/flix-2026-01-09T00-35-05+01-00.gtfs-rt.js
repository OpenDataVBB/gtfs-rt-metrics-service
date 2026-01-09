export default {
	header: {
		gtfs_realtime_version: '2.0',
		incrementality: 0,
		// Weird `Long` create by protobufjs (via gtfs-rt-bindings).
		timestamp: {low: 1767915306, high: 0, unsigned: true},
	},
	entity: [
		{
			id: '2686-1-1400112025-BUF#6MT-00-stoptimes',
			trip_update: {
				trip: {
					trip_id: '2686-1-1400112025-BUF#6MT-00',
					start_time: '14:00:00',
					start_date: '20251126',
					schedule_relationship: 0,
				},
				stop_time_update: [
					{
						stop_sequence: 1,
						departure: {
							delay: 108,
						},
						stop_id: '9a1b39b7-d723-4cf7-85dd-a34e3521568c',
						schedule_relationship: 0,
					},
				],
				// Weird `Long` create by protobufjs (via gtfs-rt-bindings).
				timestamp: {low: 1767915258, high: 0, unsigned: true},
				vehicle: {
					id: 'e853b953-b66f-449d-be8e-82163605cbeb',
				},
			},
		},
		{
			id: 'N1153-1-0255012026-DO#AOS-00-position',
			vehicle: {
				trip: {
					trip_id: 'N1153-1-0255012026-DO#AOS-00',
					start_time: '02:55:00',
					start_date: '20260108',
					schedule_relationship: 0,
				},
				vehicle: {
					id: '9bd21c08-97e7-42d2-aaa7-b9a95cbfdc30',
				},
				// Weird `Long` create by protobufjs (via gtfs-rt-bindings).
				timestamp: {low: 1767915208, high: 0, unsigned: true},
				position: {
					latitude: 44.88161087036133,
					longitude: -0.511385977268219
				},
			},
		},
		{
			id: 'N885-2-0300012026-AMD#ZAG-00-position',
			vehicle: {
				trip: {
					trip_id: 'N885-2-0300012026-AMD#ZAG-00',
					start_time: '03:00:00',
					start_date: '20260108',
					schedule_relationship: 0,
				},
				vehicle: {
					id: '46bcf2be-7b2c-4a5d-9bd9-91c42ff6f09b',
				},
				// Weird `Long` create by protobufjs (via gtfs-rt-bindings).
				timestamp: {low: 1767911407, high: 0, unsigned: true},
				position: {
					latitude: 46.69671630859375,
					longitude: 13.644511222839355
				},
			},
		},
		{
			id: 'N1153-1-0255012026-DO#AOS-00-stoptimes',
			trip_update: {
				trip: {
					trip_id: 'N1153-1-0255012026-DO#AOS-00',
					start_time: '02:55:00',
					start_date: '20260108',
					schedule_relationship: 0,
				},
				vehicle: {
					id: '9bd21c08-97e7-42d2-aaa7-b9a95cbfdc30',
				},
				// Weird `Long` create by protobufjs (via gtfs-rt-bindings).
				timestamp: {low: 1767915261, high: 0, unsigned: true},
				stop_time_update: [
					{
						stop_sequence: 1,
						departure: {
							delay: -164,
						},
						stop_id: 'dcbaeef4-9603-11e6-9066-549f350fcb0c',
						schedule_relationship: 0,
					},
					{
						stop_sequence: 3,
						arrival: {
							delay: -1834,
						},
						departure: {
							delay: 178,
						},
						stop_id: 'dcbaca96-9603-11e6-9066-549f350fcb0c',
						schedule_relationship: 0,
					},
					{
						stop_sequence: 4,
						arrival: {
							delay: -278,
						},
						departure: {
							delay: -482,
						},
						stop_id: 'dcc54142-9603-11e6-9066-549f350fcb0c',
						schedule_relationship: 0,
					},
					{
						stop_sequence: 5,
						arrival: {
							delay: -312,
						},
						departure: {
							delay: 298,
						},
						stop_id: '357e465b-8a94-4c9a-9bae-cd0b5369f33b',
						schedule_relationship: 0,
					},
				],
			},
		},
	],
}
