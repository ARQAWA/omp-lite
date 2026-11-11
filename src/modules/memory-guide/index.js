// Appends a short memory-use block to the system prompt while Mnemopi is on.
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import text from "./memory-guide.json";

export default function memoryGuide(pi) {
	pi.on("before_agent_start", event => {
		if (lookup("memory.backend")?.get(pi.pi.settings) !== "mnemopi") return;
		return { systemPrompt: [...event.systemPrompt, text.block] };
	});
}
