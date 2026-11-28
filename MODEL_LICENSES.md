# Model licensing and downloads

Both npm packages run deterministic rules. They include no model weights and make no model-download requests.

| Distribution | License | Download size | Missing-model behavior |
| --- | --- | --- | --- |
| Default core and CLI | MIT code | 0 bytes of model weights | Deterministic classification, policy and repeated-line compression remain available |
| Yudi fine-tuned `cts_classifier`, `cts_t5` | Proprietary; excluded from the MIT grant | Not distributed; size not established for an npm artifact | Never required or loaded by the npm packages |
| Legacy development model helpers | Each model/dependency has separate upstream terms | Not part of this release | Not imported by the public SDK, proxy or MCP |

`echoregent models` reports the rules-only state. Version 0.4.0 ships no optional-model downloader. A future model integration must require an explicit download action, pinned artifact/revision, verified license, exact size, checksum, destination and clearly reported fallback. Do not treat a base model's license as permission to redistribute private fine-tuned weights. No install/startup hook downloads weights silently.

The root [LICENSE](LICENSE) is the standard MIT grant for the code. The proprietary-weight exclusion, moved here from LICENSE unchanged, is:

> Note on model weights:
> The fine-tuned model weights (cts_classifier, cts_t5) are NOT included in this
> repository and are NOT covered by this license. They are proprietary to Yudi Labs.
> Self-hosted deployments use base HuggingFace models. Access to Yudi-trained weights
> is available via the managed API at yudi.co.in.

Local middleware does not make LLM inference offline: provider requests still go to the user's configured upstream service, under that provider's terms.
