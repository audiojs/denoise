// atom manifest — wraps the AR-extrapolation de-clip kernel per @audio/atom
// CONTRACT. declip.js fits AR models on left AND right un-clipped context around each
// clipped run (`context` samples on both sides) and exposes a single whole-array call
// (`declip(data, params)`) with no streaming variant — an "AR reconstruction over the
// file" case, so streaming: false, matching the leveler exemplar's whole-buffer shape.
//
// clipLevel: 0 selects the kernel's own auto-detection (`autoClipLevel` — most frequent
// |sample| above 0.5, falling back to peak); any nonzero value is passed straight
// through. This is the "prefer auto-profiling defaults" case from a different angle
// than a noise profile — clipLevel is a scalar, not an array, so it CAN be a contract
// param; 0 is a safe sentinel since a real clip level always sits near 1.0, and the
// kernel itself already treats clipLevel<=0 as "nothing to do".

import declip_ from './declip.js'

export const declip = (ctx) => {
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		const clipLevel = params.clipLevel[0]
		const opts = {
			order: Math.round(params.order[0]),
			context: Math.round(params.context[0]),
			maxRun: Math.round(params.maxRun[0]),
		}
		if (clipLevel > 0) opts.clipLevel = clipLevel
		for (let c = 0; c < inp.length; c++) out[c].set(declip_(inp[c], opts))
	}
}
declip.channels = 'any'
declip.streaming = false
declip.tail = 0
declip.params = {
	clipLevel: { type: 'number', min: 0, max: 1, default: 0 },        // 0 = auto-detect
	order:     { type: 'number', min: 10, max: 300, default: 100 },   // AR order
	context:   { type: 'number', min: 10, max: 2000, default: 400 },  // un-clipped samples used for the AR fit
	maxRun:    { type: 'number', min: 1, max: 500, default: 50 },     // longest clipped run repaired
}
