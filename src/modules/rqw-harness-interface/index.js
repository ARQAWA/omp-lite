import advisor from "./advisor.js";
import modelPicker from "./model-picker.js";
import subscriptions from "./subscriptions.js";
import compactions from "./compactions.js";
import toolSummary from "./tool-summary.js";
import turnDuration from "./turn-duration.js";

export default pi => {
	modelPicker(pi, advisor(pi));
	for (const part of [subscriptions, compactions, toolSummary, turnDuration]) part(pi);
};
