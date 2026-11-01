import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { API_BASE } from "../lib/api";

export default function ReportReview({
  conversation,
  attachmentCount,
  name,
  phone,
  initialData,
  onCancel,
  onSubmit,
}) {
  const [description, setDescription] = useState(initialData?.summary || "");
  const [summaryStatus, setSummaryStatus] = useState(
    initialData?.summary ? "" : "Preparing summary…",
  );
  const edited = useRef(Boolean(initialData?.summary));
  const locationEdited = useRef(Boolean(initialData?.location));
  const initialConversation = useRef(
    conversation.map((message) => ({
      role: message.from,
      content: message.text,
    })),
  );
  const [reporterName, setReporterName] = useState(
    initialData?.reporter_name || (name === "Reporter" ? "" : name),
  );
  const [reporterPhone, setReporterPhone] = useState(
    initialData?.reporter_phone || phone || "",
  );
  const [locationName, setLocationName] = useState(initialData?.location || "");
  const [location, setLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submissionId = useRef(crypto.randomUUID());

  useEffect(() => {
    if (initialData?.summary) return;
    const controller = new AbortController();
    async function prepareSummary() {
      try {
        const response = await fetch(`${API_BASE}/api/chat/report-summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ messages: initialConversation.current }),
        });
        const data = await response.json().catch(() => null);
        if (
          !response.ok ||
          typeof data?.summary !== "string" ||
          !data.summary.trim()
        )
          throw new Error(
            "Summary unavailable. Please write a brief summary yourself.",
          );
        if (!edited.current) setDescription(data.summary);
        if (!locationEdited.current && typeof data.location === "string")
          setLocationName(data.location);
        setSummaryStatus("");
      } catch (failure) {
        if (failure.name !== "AbortError")
          setSummaryStatus(
            "Summary unavailable. Please write a brief summary yourself.",
          );
      }
    }
    void prepareSummary();
    return () => controller.abort();
  }, [initialData]);

  function captureLocation() {
    if (!navigator.geolocation) {
      setLocationStatus("GPS is unavailable. Enter the address or landmark.");
      return;
    }
    setLocationStatus("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          location_accuracy_m: position.coords.accuracy,
        });
        setLocationStatus(
          `GPS captured, within approximately ${Math.round(position.coords.accuracy)} m. Add an address or landmark too.`,
        );
      },
      () =>
        setLocationStatus("Could not get GPS. Enter the address or landmark."),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    );
  }

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    const digits = reporterPhone.replace(/\D/g, "");
    if (
      digits.length < 7 ||
      digits.length > 15 ||
      !/^\+?[\d\s()-]+$/.test(reporterPhone)
    ) {
      setError(
        "Enter a valid callback number, including country code where needed.",
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSubmit({
        submission_id: submissionId.current,
        reporter_name: reporterName.trim(),
        reporter_phone: reporterPhone.trim(),
        location_name: locationName.trim(),
        description: description.trim(),
        attachments: [],
        ...(location || {}),
      });
    } catch (failure) {
      setError(
        failure.message || "Could not submit the report. Please try again.",
      );
      setSaving(false);
    }
  }

  return (
    <form
      className="report-review"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !saving) {
          event.preventDefault();
          onCancel();
        }
        if (event.key !== "Tab") return;
        const controls = [
          ...event.currentTarget.querySelectorAll(
            "input:not(:disabled), textarea:not(:disabled), button:not(:disabled)",
          ),
        ];
        if (!controls.length) return;
        if (event.shiftKey && document.activeElement === controls[0]) {
          event.preventDefault();
          controls.at(-1).focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === controls.at(-1)
        ) {
          event.preventDefault();
          controls[0].focus();
        }
      }}
    >
      <div className="report-review-heading">
        <span className="shortcut-icon">
          <Icon name="file" size={22} />
        </span>
        <div>
          <h3>Review your report</h3>
          <p>
            Check these details before sending them to the response workspace.
          </p>
        </div>
      </div>
      <label htmlFor="review-description">
        What happened and current condition
      </label>
      <textarea
        id="review-description"
        value={description}
        onChange={(event) => {
          edited.current = true;
          setDescription(event.target.value);
        }}
        required
        maxLength={2000}
        rows={5}
        autoFocus
      />
      <p className="report-review-hint" role="status">
        {summaryStatus ||
          "Review the summary and correct any missing or incorrect details."}
      </p>
      {attachmentCount > 0 && (
        <p className="report-review-hint">
          {attachmentCount} {attachmentCount === 1 ? "image" : "images"} will be
          sent with this report.
        </p>
      )}
      <label htmlFor="review-name">Your name</label>
      <input
        id="review-name"
        value={reporterName}
        onChange={(event) => setReporterName(event.target.value)}
        required
        maxLength={80}
        autoComplete="name"
      />
      <label htmlFor="review-phone">Callback phone number</label>
      <input
        id="review-phone"
        type="tel"
        value={reporterPhone}
        onChange={(event) => setReporterPhone(event.target.value)}
        required
        maxLength={22}
        autoComplete="tel"
      />
      <label htmlFor="review-location">Incident address or landmark</label>
      <input
        id="review-location"
        value={locationName}
        onChange={(event) => {
          locationEdited.current = true;
          setLocationName(event.target.value);
        }}
        required
        maxLength={300}
        autoComplete="street-address"
      />
      <button
        type="button"
        className="secondary-button"
        onClick={captureLocation}
      >
        <Icon name="locate" size={16} />
        Add GPS location
      </button>
      {locationStatus && (
        <p className="report-review-hint" role="status">
          {locationStatus}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="report-review-hint">
        This prototype does not contact emergency services. For an emergency in
        India, call 112 directly.
      </p>
      <div className="report-review-actions">
        <button
          type="submit"
          className="primary-button red-button"
          disabled={saving}
        >
          {saving ? "Sending…" : "Confirm and send report"}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
