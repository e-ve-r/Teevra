import { useEffect, useId, useRef, useState } from "react";
import Icon from "./Icon";
import TacticalMap from "./Department/TacticalMap";
import { uploadAttachments } from "../lib/api";

export default function ReportForm({ active, onSubmit, reporterName, isUpdate = false }) {
  const descriptionId = useId();
  const [phone, setPhone] = useState("");
  const [locationName, setLocationName] = useState("");
  const [location, setLocation] = useState(null);
  const [locationMessage, setLocationMessage] = useState("Requesting your current location…");
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState([]);
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [pending, setPending] = useState(false);
  const imageInput = useRef(null);
  const cameraInput = useRef(null);
  const audioInput = useRef(null);
  const recorder = useRef(null);
  const stream = useRef(null);
  const urls = useRef(new Set());
  const mounted = useRef(true);
  const isActive = useRef(active);
  const busy = useRef(false);
  const manualLocation = useRef(false);

  useEffect(() => {
    if (!active || isUpdate || manualLocation.current) return;
    if (!navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition((position) => {
      if (manualLocation.current) return;
      setLocation({ lat: position.coords.latitude, lng: position.coords.longitude, location_accuracy_m: position.coords.accuracy });
      setLocationMessage(`GPS captured · accurate to about ${Math.round(position.coords.accuracy)} m`);
    }, (failure) => {
      setLocationMessage(failure.code === 1 ? "Location access denied. Enter the incident address below." : "GPS unavailable. Enter the incident address below.");
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
    return () => navigator.geolocation.clearWatch(watch);
  }, [active, isUpdate]);

  useEffect(() => {
    isActive.current = active;
  }, [active]);
  useEffect(() => {
    mounted.current = true;
    const ownedUrls = urls.current;
    return () => {
      mounted.current = false;
      if (recorder.current?.state === "recording") {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      stream.current?.getTracks().forEach((track) => track.stop());
      ownedUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);
  useEffect(() => {
    if (!active) {
      if (recorder.current?.state === "recording") recorder.current.stop();
    }
  }, [active]);
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  function addFiles(incoming, kind) {
    setError("");
    const valid = [];
    for (const file of incoming) {
      if (!file.type.startsWith(`${kind}/`)) {
        setError(
          `Choose ${kind === "image" ? "an image" : "an audio"} file to continue.`,
        );
        continue;
      }
      if (file.size > 20 * 1024 * 1024) {
        setError("Please keep each file smaller than 20 MB.");
        continue;
      }
      const url = URL.createObjectURL(file);
      urls.current.add(url);
      valid.push({
        id: crypto.randomUUID(),
        name: file.name,
        kind,
        url,
        size: file.size,
        file,
      });
    }
    setFiles((current) => [...current, ...valid]);
  }
  function removeFile(file) {
    URL.revokeObjectURL(file.url);
    urls.current.delete(file.url);
    setFiles((current) => current.filter((item) => item.id !== file.id));
  }
  async function toggleRecording() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError(
        "Voice recording is unavailable here. You can upload an audio file instead.",
      );
      busy.current = false;
      setPending(false);
      return;
    }
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (!mounted.current || !isActive.current) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = mediaStream;
      const mediaRecorder = new MediaRecorder(mediaStream);
      recorder.current = mediaRecorder;
      const chunks = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      mediaRecorder.onstop = () => {
        const type = mediaRecorder.mimeType || "audio/webm";
        const extension = type.includes("mp4")
          ? "m4a"
          : type.includes("ogg")
            ? "ogg"
            : "webm";
        if (chunks.length && mounted.current)
          addFiles(
            [
              new File(
                chunks,
                `Voice report ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}.${extension}`,
                { type },
              ),
            ],
            "audio",
          );
        mediaStream.getTracks().forEach((track) => track.stop());
        if (mounted.current) setRecording(false);
      };
      mediaRecorder.onerror = () => {
        mediaStream.getTracks().forEach((track) => track.stop());
        if (mounted.current) {
          setRecording(false);
          setError(
            "Recording stopped unexpectedly. Please try again or upload audio.",
          );
        }
      };
      mediaRecorder.start();
      setSeconds(0);
      setRecording(true);
    } catch {
      stream.current?.getTracks().forEach((track) => track.stop());
      if (mounted.current)
        setError(
          "Microphone access was unavailable. Allow it in your browser, or upload an audio file.",
        );
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
  async function submit(event) {
    event.preventDefault();
    if (recording || pending || saving) return;
    if (!description.trim() && !files.length) {
      setError("Add a photo, describe what happened, or record a voice note first.");
      return;
    }
    if (!isUpdate && !location && !locationName.trim()) {
      setError("Enter the incident address, or allow location access.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const attachments = await uploadAttachments(files);
      const freshLocation = manualLocation.current ? location : location ? await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition((position) => resolve({
          lat: position.coords.latitude, lng: position.coords.longitude, location_accuracy_m: position.coords.accuracy,
        }), () => resolve(null), { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 });
      }) : null;
      if (!isUpdate && !freshLocation && !locationName.trim()) throw new Error("Could not refresh GPS. Enter the incident address and submit again.");
      await onSubmit({
        description: description.trim(), attachments,
        reporter_name: reporterName, reporter_phone: phone.trim(),
        ...(freshLocation || {}),
        ...((locationName.trim() || freshLocation) ? { location_name: locationName.trim() || `${manualLocation.current ? "Map pin" : "GPS"}: ${freshLocation.lat.toFixed(5)}, ${freshLocation.lng.toFixed(5)}` } : {}),
      });
      setDescription("");
      files.forEach((file) => { URL.revokeObjectURL(file.url); urls.current.delete(file.url); });
      setFiles([]);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="report-form surface" onSubmit={submit}>
      <fieldset disabled={saving} className="report-fields">
      {!isUpdate && <div className="report-contact-grid">
        <label>Mobile number
          <input type="tel" autoComplete="tel" placeholder="+91 …" value={phone} onChange={(e) => setPhone(e.target.value)} required pattern="[+]?[0-9 ()-]{7,22}" />
          <small>Include your country code so the response team can call back.</small>
        </label>
        <label>Incident location
          <input value={locationName} onChange={(e) => setLocationName(e.target.value)} placeholder={location ? "Add a nearby landmark (optional)" : "Street, landmark, city"} required={!location} maxLength={300} />
          <small role="status">{navigator.geolocation ? locationMessage : "GPS is unavailable. Enter the incident address."}</small>
        </label>
        {location && <p className="gps-detail"><Icon name="pin" size={15} /> {location.lat.toFixed(5)}, {location.lng.toFixed(5)} · Incident coordinates
          <button type="button" onClick={() => { manualLocation.current = true; setLocation(null); setLocationMessage("Using the incident address you enter below."); }}>Use address instead</button>
        </p>}
        <div className="report-map-picker"><TacticalMap incident={location ? { ...location, location_name: locationName } : null} height="240px" onLocationPick={(point) => { manualLocation.current = true; setLocation(point); setLocationMessage("Incident pin selected on the map."); }} /></div>
      </div>}
      {isUpdate && <p className="update-intro">Tell us what changed. New details trigger a fresh assessment for your response team.</p>}
      <div className="section-label">
        <span className="number-label">01</span>
        <h2>Show us what happened</h2>
        <span className="optional">Optional</span>
      </div>
      <div className="upload-options">
        <button
          type="button"
          className="upload-option"
          onClick={() => cameraInput.current?.click()}
        >
          <span className="upload-icon">
            <Icon name="camera" size={30} />
          </span>
          <strong>Open camera</strong>
          <span>Take a photo</span>
        </button>
        <button
          type="button"
          className="upload-option"
          onClick={() => imageInput.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            addFiles(e.dataTransfer.files, "image");
          }}
        >
          <span className="upload-icon">
            <Icon name="image" size={30} />
          </span>
          <strong>Upload image</strong>
          <span>Choose from gallery</span>
        </button>
      </div>
      <input
        className="sr-only"
        ref={imageInput}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          addFiles(e.target.files, "image");
          e.target.value = "";
        }}
        aria-label="Upload images"
      />
      <input
        className="sr-only"
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          addFiles(e.target.files, "image");
          e.target.value = "";
        }}
        aria-label="Take a photo"
      />
      <input
        className="sr-only"
        ref={audioInput}
        type="file"
        accept="audio/*"
        multiple
        onChange={(e) => {
          addFiles(e.target.files, "audio");
          e.target.value = "";
        }}
        aria-label="Upload audio recordings"
      />
      {files.length > 0 && (
        <div className="attachments-list" aria-live="polite">
          {files.map((file) => (
            <div key={file.id} className="attachment">
              {file.kind === "image" ? (
                <a href={file.url} target="_blank" rel="noreferrer">
                  <img src={file.url} alt={file.name} />
                </a>
              ) : (
                <span className="audio-file-icon">
                  <Icon name="mic" size={21} />
                </span>
              )}
              <div className="attachment-info">
                <strong>{file.name}</strong>
                {file.kind === "audio" ? (
                  <audio controls src={file.url} preload="metadata" />
                ) : (
                  <span>
                    {(file.size / 1024 / 1024).toFixed(2)} MB · Ready to include
                  </span>
                )}
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => removeFile(file)}
                aria-label={`Remove ${file.name}`}
              >
                <Icon name="cross" size={18} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="section-label text-section">
        <span className="number-label">02</span>
        <label htmlFor={descriptionId}>{isUpdate ? "What has changed?" : "Describe the emergency"}</label>
      </div>
      <div className="description-field">
        <textarea
          id={descriptionId}
          placeholder="What happened? Include the location and any details that could help."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={4}
          aria-describedby={`${descriptionId}-count`}
        />
        <div className="textarea-footer">
          <button
            type="button"
            className={`inline-mic ${recording ? "is-recording" : ""}`}
            aria-label={
              recording ? "Stop voice recording" : "Start voice reporting"
            }
            disabled={pending}
            onClick={toggleRecording}
          >
            <Icon name="mic" size={20} />
          </button>
          <span id={`${descriptionId}-count`}>{description.length}/2000</span>
        </div>
      </div>
      <div className={`voice-report ${recording ? "is-recording" : ""}`}>
        <button
          type="button"
          className="voice-button"
          disabled={pending}
          onClick={toggleRecording}
        >
          <span className="voice-icon">
            <Icon name={recording ? "minus" : "mic"} size={23} />
          </span>
          <span>
            <strong>
              {pending
                ? "Opening microphone…"
                : recording
                  ? `Stop recording · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
                  : "Prefer to speak?"}
              <small>
                {recording
                  ? "Recording your voice note"
                  : "Tap to record your report"}
              </small>
            </strong>
          </span>
          <Icon name="chevron" size={19} />
        </button>
      </div>
      <button
        type="button"
        className="audio-upload"
        disabled={recording || pending}
        onClick={() => audioInput.current?.click()}
      >
        <Icon name="upload" size={15} /> Upload an existing recording
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="primary-button red-button submit-report"
        disabled={recording || pending || saving}
      >
        <Icon name="send" size={21} /> {saving ? "Saving and assessing…" : isUpdate ? "Send situation update" : "Submit report"}{" "}
        <Icon name="arrow" size={21} />
      </button>
      <p className="form-footnote">
        <Icon name="lock" size={13} /> Reports and media are saved for the response team. AI assessment uses OpenRouter.
      </p>
      </fieldset>
    </form>
  );
}
