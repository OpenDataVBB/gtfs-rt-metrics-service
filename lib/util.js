import {toBigInt as _protobufJsLongToBigInt} from 'longfn'

// selected from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects#error_objects
const PROGRAMMER_ERRORS = [
	RangeError,
	ReferenceError,
	SyntaxError,
	TypeError,
	URIError,
]
const isProgrammerError = (err) => {
	// todo: use `PROGRAMMER_ERRORS.includes(err.__proto__.constructor)`?
	return PROGRAMMER_ERRORS.some(Err => err instanceof Err)
}

// todo: let gtfs-rt-bindings decode protobuf properly, instead of parsing protobuf (u)int64 into BigInts here
const protobufJsLongToBigInt = (val) => {
	if (typeof val === 'bigint') return val
	return _protobufJsLongToBigInt(val)
}

export {
	PROGRAMMER_ERRORS,
	isProgrammerError,
	protobufJsLongToBigInt,
}
