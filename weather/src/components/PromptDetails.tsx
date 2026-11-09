import type { ImageState, Weather } from "../../shared/types";

function formatDate(iso: string | undefined, timeZone: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function PromptDetails({
  image,
  weather,
}: {
  image: ImageState | null;
  weather: Weather;
}) {
  if (!image || (image.status !== "ready" && image.status !== "generating")) {
    return null;
  }

  const context = image.weatherContext ?? weather.imageContext;
  const promptSource =
    image.promptSource === "llm"
      ? "Multimodal LLM"
      : image.promptSource === "fallback"
        ? "Fallback template"
        : "—";

  return (
    <section className="panel details-panel" aria-labelledby="details-heading">
      <details>
        <summary id="details-heading">
          <span>How this image was made</span>
          <span className="details-hint">multimodal prompt → image-to-image</span>
        </summary>

        <div className="details-grid">
          <div className="detail-block">
            <h3>Weather brief sent to the vision model</h3>
            <pre>{context}</pre>
          </div>

          <div className="detail-block">
            <h3>Image-editing prompt</h3>
            <pre>{image.prompt ?? "Generating the art direction…"}</pre>
            {image.caption && <p className="detail-caption">{image.caption}</p>}

            <dl className="meta-list">
              <div>
                <dt>Prompt model</dt>
                <dd>{image.models?.prompt ?? "—"}</dd>
              </div>
              <div>
                <dt>Image model</dt>
                <dd>{image.models?.image ?? "—"}</dd>
              </div>
              <div>
                <dt>Prompt source</dt>
                <dd>{promptSource}</dd>
              </div>
              <div>
                <dt>Generated</dt>
                <dd>{formatDate(image.generatedAt, weather.timeZone)}</dd>
              </div>
              <div>
                <dt>Generation time</dt>
                <dd>
                  {image.durationMs != null
                    ? `${(image.durationMs / 1000).toFixed(1)}s`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Estimated cost</dt>
                <dd>
                  {image.costUsd != null ? `$${image.costUsd.toFixed(4)}` : "—"}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </details>
    </section>
  );
}
