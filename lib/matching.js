const tripDescriptorsMatch = (schedTripDesc, rtTripDesc) => {
	// We implement a stricter matching algorithm here than what the spec says:
	// > To specify a single trip instance, in many cases a trip_id by itself is sufficient. However, the following cases require additional information to resolve to a single trip instance:
	// > - If the trip lasts for more than 24 hours, or is delayed such that it would collide with a scheduled trip on the following day, then start_date is required in addition to trip_id.
	// > […]
	// – https://gtfs.org/documentation/realtime/reference/#message-tripdescriptor
	// We only allow `start_date` to be omitted if the trip's service schedule has exactly 1 date.
	// todo: consider if we should strictly follow the spec – analyse the mobility database's RT feeds if start_date is common
	if (
		schedTripDesc.trip_id && schedTripDesc.trip_id === rtTripDesc.trip_id
		&& (
			schedTripDesc.trip_has_only_1_service_date
			|| (schedTripDesc.start_date && schedTripDesc.start_date === rtTripDesc.start_date)
		)
	) {
		if (rtTripDesc.start_time && schedTripDesc.start_time !== rtTripDesc.start_time) {
			return false
		}
		// > - For trips defined in frequencies.txt, start_date and start_time are required in addition to trip_id
		return schedTripDesc.trip_has_frequencies
			? Boolean(rtTripDesc.start_time && schedTripDesc.start_time === rtTripDesc.start_time)
			: true
	}
	// > - If the trip_id field can't be provided, then route_id, direction_id, start_date, and start_time must all be provided
	if (
		schedTripDesc.route_id && schedTripDesc.route_id === rtTripDesc.route_id
		&& schedTripDesc.direction_id && schedTripDesc.direction_id === rtTripDesc.direction_id
		&& schedTripDesc.start_date && schedTripDesc.start_date === rtTripDesc.start_date
		&& schedTripDesc.start_time && schedTripDesc.start_time === rtTripDesc.start_time
	) {
		return true
	}
	return false
}

export {
	tripDescriptorsMatch,
}
