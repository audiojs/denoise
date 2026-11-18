// atom manifest: wraps deecho.js per @audio/compile CONTRACT. The echo is found in the whole take (its cepstral peak
// reads every part of it, and is checked in each part), so it needs the whole clip: streaming: false, as dereverb and
// dehum; the host hands it the input in one block. Each channel is found and undone on its own, so a stereo take whose
// channels echo apart (a ping-pong delay, a wall nearer one microphone) comes back with each channel's own undone.
// delay 0: found; gain 0: measured at the delay (with its feedback); a gain given takes its feedback as given (0: one
// copy). Zero latency, no tail: the inverse filter reads only the past.
// A setting the kernel cannot undo, which it refuses, is held to the nearest it can (the declared ranges admit them,
// and a processor never throws inside its ranges): a delay under one sample to one sample; a feedback at 0.95 or over
// a millionth under it, and a gain whose inverse with that feedback would not die away (|gain − feedback| at 0.95 or
// over: a copy that loud has no stable inverse) a millionth inside that bound. Every other setting is passed as it is.

import deecho_, { STABLE } from './deecho.js'

const IN = 1e-6
export const deecho = (ctx) => {
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		const fs = ctx.sampleRate, delay = params.delay[0], gain = params.gain[0]
		const feedback = params.feedback[0] < STABLE ? params.feedback[0] : STABLE - IN
		const g = gain <= feedback - STABLE ? feedback - STABLE + IN : gain >= feedback + STABLE ? feedback + STABLE - IN : gain
		for (let c = 0; c < inp.length; c++) out[c].set(deecho_(inp[c], {
			fs, delay: delay ? Math.max(delay, 1 / fs) : undefined, gain: gain ? g : undefined, feedback: gain ? feedback : undefined,
		}))
	}
}
deecho.channels = 'any'
deecho.streaming = false
deecho.tail = 0
deecho.params = {
	delay:    { type: 'number', min: 0, max: 4, default: 0, unit: 's' },   // 0: found, 1 ms to 1 s
	gain:     { type: 'number', min: -0.95, max: 1.9, default: 0 },        // the first copy's gain to the sound; 0: measured
	feedback: { type: 'number', min: 0, max: 0.95, default: 0 },           // each further copy's gain to the one before (0: one copy)
}
