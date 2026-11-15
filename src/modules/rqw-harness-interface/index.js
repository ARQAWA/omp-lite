import modelPicker from "./model-picker.js";
import subscriptions from "./subscriptions.js";
import compactions from "./compactions.js";
import toolSummary from "./tool-summary.js";
import turnDuration from "./turn-duration.js";

export default function rqwHarnessInterface(pi) {
	for (const part of [modelPicker, subscriptions, compactions, toolSummary, turnDuration]) part(pi);
}
