// The stop is skipped, i.e., the vehicle will not stop at this stop.
// Arrival and departure are optional.
const STU_SCHEDULE_RELATIONSHIP_SKIPPED = 1

const stuSchedRelSkipped1 = {
	header: {
		gtfs_realtime_version: '2.0',
		incrementality: 0,
		// Weird `Long` create by protobufjs (via gtfs-rt-bindings).
		timestamp: {low: 1767930000, high: 0, unsigned: true},
	},
	entity: [
		{
			id: 'N1153-stu-sched-rel-skipped-1',
			trip_update: {
				trip: {
					trip_id: 'N1153-1-0255012026-DO#AOS-00',
					start_time: '02:55:00',
					start_date: '20260108',
				},
				vehicle: {
					id: '9bd21c08-97e7-42d2-aaa7-b9a95cbfdc30',
				},
				// Weird `Long` create by protobufjs (via gtfs-rt-bindings).
				timestamp: {low: 1767930000, high: 0, unsigned: true},
				stop_time_update: [
					{
						stop_sequence: 3,
						stop_id: 'dcbaca96-9603-11e6-9066-549f350fcb0c',
						schedule_relationship: STU_SCHEDULE_RELATIONSHIP_SKIPPED,
					},
					{
						stop_sequence: 10,
						schedule_relationship: STU_SCHEDULE_RELATIONSHIP_SKIPPED,
					},
				],
			},
		},
	],
}

export {
	stuSchedRelSkipped1,
}
