// atom manifest: wraps deecho.js per @audio/compile CONTRACT. The echo is found in the whole take (its cepstral peak
// reads every part of it, and is checked in each part), so it needs the whole clip: streaming: false, as dereverb and
// dehum; the host hands it the input in one block. Each channel is found and undone on its own, so a stereo take whose
// channels echo apart (a ping-pong delay, a wall nearer one microphone) comes back with each channel's own undone.
// delay 0: found; gain 0: measured at the delay (with its feedback); a gain given takes its feedback as given (0: one
// copy). Zero latency, no tail: the inverse filter reads only the past.

import deecho_ from './deecho.js'

export const deecho = (ctx) => {
	return (inputs, outputs, params) => {
		const inp = inputs[0], out = outputs[0]
		if (!inp || !inp.length) return
		const delay = params.delay[0], gain = params.gain[0], feedback = params.feedback[0]
		for (let c = 0; c < inp.length; c++) out[c].set(deecho_(inp[c], {
			fs: ctx.sampleRate, delay: delay || undefined, gain: gain || undefined, feedback: gain ? feedback : undefined,
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
