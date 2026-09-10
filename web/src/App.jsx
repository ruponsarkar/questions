import { useEffect, useMemo, useRef, useState } from "react";

const FACEBOOK_IMAGE_FORMATS = {
  "1080x1080": { label: "1080 × 1080 px", width: 1080, height: 1080 },
  "1080x1350": { label: "1080 × 1350 px", width: 1080, height: 1350 },
  "1200x630": { label: "1200 × 630 px", width: 1200, height: 630 },
};

export default function App() {
  const [subjects, setSubjects] = useState([]);
  const [syllabuses, setSyllabuses] = useState([]);

  const [form, setForm] = useState({
    subjectId: "",
    syllabusId: "",
    questionCount: 5,
    perPage: 5,
    timerSeconds: 5,
    recordVideo: false,
    narrateVideo: true,
    voiceName: "en-IN-PrabhatNeural",
    videoAudioMode: "both",
    musicVolume: 0.25,
    voiceVolume: 1,
    facebookImageFormat: "1080x1080",
  });

  const [quizState, setQuizState] = useState({
    loading: false,
    error: "",
    availableCount: 0,
    questions: [],
  });

  const [session, setSession] = useState(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [recordingState, setRecordingState] = useState("idle");
  const [speechVoices, setSpeechVoices] = useState([]);
  const [isVoicePreviewPlaying, setIsVoicePreviewPlaying] = useState(false);
  const [isFacebookImageGenerating, setIsFacebookImageGenerating] = useState(false);
  const [facebookImageError, setFacebookImageError] = useState("");
  const sessionRef = useRef(null);
  const remainingSecondsRef = useRef(0);
  const recordingRef = useRef(null);
  const narrationAudioRef = useRef(null);
  const narrationCacheRef = useRef(new Map());
  const narrationPlaybackIdRef = useRef(0);
  const revealingQuestionIdsRef = useRef(new Set());
  const audioPreviewRef = useRef(null);
  const advanceAnimationStartedAtRef = useRef(0);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    remainingSecondsRef.current = remainingSeconds;
  }, [remainingSeconds]);

  useEffect(() => {
    let isMounted = true;

    fetch("/api/narration/voices")
      .then((response) => response.json())
      .then((data) => {
        if (!isMounted) {
          return;
        }

      const availableVoices = data.voices || [];
      setSpeechVoices(availableVoices);
      setForm((current) => {
        if (!availableVoices.length) {
          return current;
        }

        if (availableVoices.some((voice) => voice.name === current.voiceName)) {
          return current;
        }

        const preferredVoice = availableVoices.find(
          (voice) => voice.name === "en-IN-PrabhatNeural",
        );
        return { ...current, voiceName: preferredVoice?.name || availableVoices[0].name };
      });
      })
      .catch(() => {
        if (isMounted) {
          setSpeechVoices([]);
        }
      });

    return () => {
      isMounted = false;
      stopNarration();
      stopAudioPreview();
    };
  }, []);

  function plainText(html) {
    const documentFragment = new DOMParser().parseFromString(html || "", "text/html");
    return documentFragment.body.textContent?.replace(/\s+/g, " ").trim() || "";
  }

  function spokenText(html) {
    return plainText(html)
      .replace(/[_]+|\.{2,}|[-–—]{2,}/g, " dash ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function questionNarrationText(question, questionNumber) {
    const options = question.options
      .map((option, index) => `Option ${index + 1}: ${spokenText(option.answerHtml)}.`)
      .join(" ");
    return `Question ${questionNumber}. ${spokenText(question.questionHtml)}. ${options}`;
  }

  function correctAnswerNarrationText(question) {
    const correctOption = question.options.find((option) => option.isRight);
    return correctOption
      ? `The correct answer is: ${spokenText(correctOption.answerHtml)}.`
      : "";
  }

  function getNarrationAudio(text, voiceName) {
    const cacheKey = `${voiceName}\u0000${text}`;
    const cachedAudio = narrationCacheRef.current.get(cacheKey);
    if (cachedAudio) {
      return cachedAudio;
    }

    const audioRequest = fetch("/api/narration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voiceName }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Unable to create narration audio.");
        }
        return response.blob();
      })
      .catch((error) => {
        narrationCacheRef.current.delete(cacheKey);
        throw error;
      });

    narrationCacheRef.current.set(cacheKey, audioRequest);
    return audioRequest;
  }

  function prefetchNarration(text, voiceName) {
    if (text) {
      void getNarrationAudio(text, voiceName).catch(() => {});
    }
  }

  function prefetchQuestionNarration(question, questionNumber, voiceName) {
    prefetchNarration(questionNarrationText(question, questionNumber), voiceName);
    prefetchNarration(correctAnswerNarrationText(question), voiceName);
  }

  function stopNarration() {
    narrationPlaybackIdRef.current += 1;
    const narration = narrationAudioRef.current;
    if (!narration) {
      return;
    }

    narration.audio.pause();
    narration.source?.disconnect();
    narration.gain?.disconnect();
    URL.revokeObjectURL(narration.url);
    narrationAudioRef.current = null;
  }

  function stopAudioPreview() {
    const preview = audioPreviewRef.current;
    if (!preview) {
      return;
    }

    preview.backgroundMusic?.audio.pause();
    preview.backgroundMusic?.source.disconnect();
    preview.backgroundMusic?.gain.disconnect();
    preview.audioContext.close();
    audioPreviewRef.current = null;
  }

  async function playNarration(text, voiceName, recording) {
    stopNarration();
    const playbackId = narrationPlaybackIdRef.current;
    const audioBlob = await getNarrationAudio(text, voiceName);
    if (playbackId !== narrationPlaybackIdRef.current) {
      return;
    }

    const url = URL.createObjectURL(audioBlob);
    const audio = new Audio(url);
    const narration = { audio, url, source: null, gain: null };
    if (recording?.audioContext && recording?.audioDestination) {
      narration.source = recording.audioContext.createMediaElementSource(audio);
      narration.gain = recording.audioContext.createGain();
      narration.gain.gain.value = recording.voiceVolume;
      narration.source.connect(narration.gain).connect(recording.audioDestination);
    }

    narrationAudioRef.current = narration;
    await new Promise((resolve, reject) => {
      let completed = false;
      let completionTimeout;
      const finish = () => {
        if (completed) {
          return;
        }
        completed = true;
        window.clearTimeout(completionTimeout);
        if (playbackId !== narrationPlaybackIdRef.current) {
          return;
        }
        if (narrationAudioRef.current === narration) {
          narrationAudioRef.current = null;
        }
        narration.source?.disconnect();
        narration.gain?.disconnect();
        URL.revokeObjectURL(url);
        resolve();
      };
      completionTimeout = window.setTimeout(finish, 30_000);
      audio.onended = finish;
      audio.onloadedmetadata = () => {
        if (Number.isFinite(audio.duration)) {
          window.clearTimeout(completionTimeout);
          completionTimeout = window.setTimeout(
            finish,
            Math.ceil(audio.duration * 1000) + 1_500,
          );
        }
      };
      audio.onerror = () => {
        window.clearTimeout(completionTimeout);
        stopNarration();
        reject(new Error("Narration audio could not play."));
      };
      audio.play().catch((error) => {
        stopNarration();
        reject(error);
      });
    });
  }

  async function narrateQuestion(question, questionNumber, voiceName, recording, onFinish) {
    const activeSession = sessionRef.current;
    const nextQuestion = activeSession?.questions[activeSession.activeQuestionIndex + 1];
    prefetchNarration(correctAnswerNarrationText(question), voiceName);
    if (nextQuestion) {
      prefetchQuestionNarration(nextQuestion, questionNumber + 1, voiceName);
    }
    try {
      await playNarration(
        questionNarrationText(question, questionNumber),
        voiceName,
        recording,
      );
    } catch {
      // Continue the quiz when local audio generation is unavailable.
    }
    onFinish?.();
  }

  async function narrateCorrectAnswer(question, voiceName, recording, onFinish) {
    const answerText = correctAnswerNarrationText(question);
    if (answerText) {
      try {
        await playNarration(
          answerText,
          voiceName,
          recording,
        );
      } catch {
        // Continue the quiz when local audio generation is unavailable.
      }
    }
    onFinish?.();
  }

  async function previewSelectedVoice() {
    const includeMusic = form.videoAudioMode !== "voice";
    const includeVoice =
      form.videoAudioMode !== "music" && form.narrateVideo && speechVoices.length > 0;
    if (!includeMusic && !includeVoice) {
      return;
    }

    setIsVoicePreviewPlaying(true);
    stopNarration();
    stopAudioPreview();

    const audioContext = new AudioContext();
    const preview = {
      audioContext,
      audioDestination: audioContext.destination,
      backgroundMusic: null,
      voiceVolume: Number(form.voiceVolume),
    };
    audioPreviewRef.current = preview;

    try {
      await audioContext.resume();
      if (includeMusic) {
        const response = await fetch("/api/music");
        const { tracks = [] } = await response.json();
        const selectedTrack = tracks[Math.floor(Math.random() * tracks.length)];
        if (selectedTrack?.url) {
          const audio = new Audio(selectedTrack.url);
          const source = audioContext.createMediaElementSource(audio);
          const gain = audioContext.createGain();
          gain.gain.value = Number(form.musicVolume);
          source.connect(gain).connect(audioContext.destination);
          audio.loop = true;
          preview.backgroundMusic = { audio, gain, source };
          await audio.play();
        }
      }

      if (includeVoice) {
        await playNarration(
          "This is a live preview of the selected video audio. The voice will remain clear over the background music.",
          form.voiceName,
          preview,
        );
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 5_000));
      }
    } catch {
    } finally {
      if (audioPreviewRef.current === preview) {
        stopAudioPreview();
      }
      setIsVoicePreviewPlaying(false);
    }
  }

  // Keep each subject visually recognizable in exported videos. The subject id
  // makes the result stable across recordings, while the name is a fallback
  // for subjects that do not have an id yet.
  function getVideoTheme(subject) {
    const identity = String(subject?.id ?? subject?.subName ?? "quiz");
    const hash = [...identity].reduce(
      (value, character) => (value * 31 + character.charCodeAt(0)) >>> 0,
      7,
    );
    const hue = hash % 360;

    return {
      hue,
      start: `hsl(${hue} 68% 96%)`,
      end: `hsl(${(hue + 32) % 360} 62% 84%)`,
      accent: `hsl(${hue} 56% 31%)`,
      card: `hsla(${hue} 62% 91% / 0.9)`,
      border: `hsla(${hue} 52% 40% / 0.5)`,
    };
  }

  function getWrappedLines(context, text, maxWidth) {
    const words = text.split(" ");
    let line = "";
    const lines = [];

    for (const word of words) {
      const nextLine = line ? `${line} ${word}` : word;
      if (context.measureText(nextLine).width <= maxWidth) {
        line = nextLine;
        continue;
      }

      if (line) {
        lines.push(line);
        line = word;
      } else {
        line = nextLine;
      }

      // A long URL or unbroken word should wrap too, rather than extending
      // beyond the card edge.
      while (context.measureText(line).width > maxWidth) {
        let splitAt = line.length - 1;
        while (splitAt > 1 && context.measureText(line.slice(0, splitAt)).width > maxWidth) {
          splitAt -= 1;
        }
        lines.push(line.slice(0, splitAt));
        line = line.slice(splitAt);
      }
    }

    if (line) {
      lines.push(line);
    }

    return lines;
  }

  function drawWrappedText(context, text, x, y, maxWidth, lineHeight) {
    const lines = getWrappedLines(context, text, maxWidth);
    lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
    return y + lines.length * lineHeight;
  }

  function drawQuestionFrame(canvas, aspect) {
    const context = canvas.getContext("2d");
    const isPortrait = aspect === "portrait";
    const width = canvas.width;
    const height = canvas.height;
    const horizontalPadding = isPortrait ? 40 : 56;
    const portraitInfoHeight = isPortrait ? 270 : 0;
    const headingTop = isPortrait ? 42 : horizontalPadding;
    const contentWidth = width - horizontalPadding * 2;
    const activeSession = sessionRef.current;

    context.clearRect(0, 0, width, height);
    const theme = activeSession?.videoTheme || getVideoTheme();
    const background = context.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, theme.start);
    background.addColorStop(1, theme.end);
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    context.fillStyle = theme.accent;
    context.font = `700 ${isPortrait ? 22 : 24}px Manrope, sans-serif`;
    const videoHeading = isPortrait
      ? "TOP QUESTIONS"
      : activeSession?.videoTitle
      ? `TOP QUESTIONS (${activeSession.videoTitle})`
      : "TOP QUESTIONS";
    const headingLineHeight = isPortrait ? 22 : 24;
    const headingLines = getWrappedLines(context, videoHeading, width - horizontalPadding * 2);
    headingLines.forEach((line, index) =>
      context.fillText(line, horizontalPadding, headingTop + index * headingLineHeight),
    );

    if (!activeSession || activeSession.completed) {
      context.fillStyle = "#1f2a17";
      context.font = `800 ${isPortrait ? 52 : 64}px Manrope, sans-serif`;
      context.fillText("Session complete", horizontalPadding, height / 2);
      return;
    }

    if (isPortrait) {
      const infoX = horizontalPadding;
      const infoWidth = contentWidth;
      context.fillStyle = "rgba(255, 255, 255, 0.46)";
      context.beginPath();
      context.roundRect(infoX, 82, infoWidth, 154, 24);
      context.fill();
      context.fillStyle = "#1f2a17";
      context.font = "800 23px Manrope, sans-serif";
      drawWrappedText(
        context,
        `Subject: ${activeSession.subjectName || "Top Questions"}`,
        infoX + 26,
        122,
        infoWidth - 52,
        28,
      );
      context.font = "700 20px Manrope, sans-serif";
      drawWrappedText(
        context,
        `Syllabus: ${activeSession.syllabusName || "General"}`,
        infoX + 26,
        177,
        infoWidth - 52,
        25,
      );
      context.fillStyle = theme.accent;
      context.font = "800 19px Manrope, sans-serif";
      context.fillText(`Questions: ${activeSession.questions.length}`, infoX + 26, 218);
    }

    const listTop = isPortrait
      ? portraitInfoHeight + 28
      : headingTop + headingLines.length * headingLineHeight + 16;
    const cardGap = isPortrait ? 20 : 16;
    const questions = activeSession.questions.slice(
      activeSession.activeQuestionIndex,
      activeSession.activeQuestionIndex + (isPortrait ? 4 : 2),
    );
    const isAdvancing = Boolean(activeSession.advancingQuestionId);
    const animationProgress = isAdvancing
      ? Math.min(1, (performance.now() - advanceAnimationStartedAtRef.current) / 480)
      : 0;
    // Reserve room for a three-line question at the recording font size.
    const activeCardHeight = 900;
    const waitingCardHeight = isPortrait ? 540 : 510;

    const drawTimerBadge = (cardTop) => {
      const badgeWidth = isPortrait ? 280 : 270;
      const badgeHeight = isPortrait ? 112 : 106;
      const badgeX = width - horizontalPadding - badgeWidth - 18;
      // Center the badge on the card edge so half sits outside the card.
      const badgeY = isPortrait ? cardTop - 24 : cardTop - badgeHeight / 2;
      const badgeCenterX = badgeX + badgeWidth / 2;
      const badgeCenterY = badgeY + badgeHeight / 2;
      const zoom = 1 + Math.sin(performance.now() / 380) * 0.035;
      const badgeGradient = context.createLinearGradient(
        badgeX,
        badgeY,
        badgeX + badgeWidth,
        badgeY + badgeHeight,
      );
      badgeGradient.addColorStop(0, "#fef3c7");
      badgeGradient.addColorStop(0.52, "#fde68a");
      badgeGradient.addColorStop(1, "#fbcfe8");

      context.save();
      context.translate(badgeCenterX, badgeCenterY);
      context.scale(zoom, zoom);
      context.translate(-badgeCenterX, -badgeCenterY);
      context.shadowColor = "rgba(249, 115, 22, 0.35)";
      context.shadowBlur = 22;
      context.shadowOffsetY = 7;
      context.fillStyle = badgeGradient;
      context.beginPath();
      context.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, badgeHeight / 2);
      context.fill();

      context.strokeStyle = "rgba(234, 88, 12, 0.62)";
      context.lineWidth = 3;
      context.beginPath();
      context.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, badgeHeight / 2);
      context.stroke();

      const ringX = badgeX + 58;
      const ringY = badgeCenterY;
      const timerProgress = activeSession.timerSeconds
        ? Math.max(0, remainingSecondsRef.current / activeSession.timerSeconds)
        : 0;
      context.strokeStyle = "rgba(154, 52, 18, 0.18)";
      context.lineWidth = 11;
      context.beginPath();
      context.arc(ringX, ringY, 34, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = "#ea580c";
      context.lineCap = "round";
      context.beginPath();
      context.arc(ringX, ringY, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * timerProgress);
      context.stroke();
      context.fillStyle = "#312e81";
      context.font = `800 ${isPortrait ? 50 : 46}px Manrope, sans-serif`;
      context.textAlign = "center";
      context.fillText(`${remainingSecondsRef.current}s`, badgeX + badgeWidth - 76, badgeY + 72);
      context.textAlign = "left";
      context.restore();
    };

    const drawQuestionCard = (question, index, top, cardHeight, opacity) => {
      const isActive = index === 0;
      const isCompact = !isActive;
      const revealed = activeSession.revealedQuestionIds.includes(question.id);
      const cardPadding = isPortrait ? 32 : 36;
      const textX = horizontalPadding + cardPadding;
      const innerWidth = contentWidth - cardPadding * 2;

      context.save();
      context.globalAlpha = opacity;
      context.beginPath();
      context.roundRect(horizontalPadding, top, contentWidth, cardHeight, 24);
      context.clip();
      context.fillStyle = isActive ? theme.card : "rgba(255, 255, 255, 0.82)";
      context.fill();
      context.strokeStyle = isActive ? theme.border : "rgba(67, 91, 39, 0.12)";
      context.lineWidth = 2;
      context.stroke();

      context.fillStyle = "#60705a";
      context.font = `700 ${isPortrait ? 18 : 17}px Manrope, sans-serif`;
      context.fillText(`Q${activeSession.activeQuestionIndex + index + 1}`, textX, top + 40);

      if (!(isActive && !revealed)) {
        if (revealed) {
          context.fillStyle = "#16733d";
          context.font = `700 ${isPortrait ? 18 : 17}px Manrope, sans-serif`;
          context.textAlign = "right";
          context.fillText("ANSWER SHOWN", width - horizontalPadding - cardPadding, top + 40);
          context.textAlign = "left";
        } else {
          context.fillStyle = "#60705a";
          context.font = `700 ${isPortrait ? 18 : 17}px Manrope, sans-serif`;
          context.textAlign = "right";
          context.fillText("WAITING", width - horizontalPadding - cardPadding, top + 40);
          context.textAlign = "left";
        }
      }

      const questionText = plainText(question.questionHtml);
      const baseQuestionFont = isCompact ? (isPortrait ? 34 : 32) : isPortrait ? 52 : 50;
      const baseQuestionLineHeight = isCompact ? (isPortrait ? 40 : 38) : isPortrait ? 60 : 58;
      const baseOptionFont = isCompact ? (isPortrait ? 26 : 28) : isPortrait ? 33 : 35;
      const baseOptionLineHeight = isCompact ? (isPortrait ? 30 : 32) : isPortrait ? 38 : 40;
      const optionGap = isCompact ? 12 : 14;
      const minimumOptionHeight = isCompact ? (isPortrait ? 76 : 74) : isPortrait ? 112 : 110;
      const questionTop = top + (isActive ? 128 : isPortrait ? 106 : 88);

      // Long questions and answers shrink together until the complete active
      // card fits in the video frame. This replaces the previous 3-line / 2-line
      // limits that silently removed trailing text.
      let textScale = 1;
      let questionLines = [];
      let optionLayouts = [];
      const availableTextHeight = cardHeight - (questionTop - top) - 32;
      do {
        context.font = `700 ${baseQuestionFont * textScale}px Manrope, sans-serif`;
        questionLines = getWrappedLines(context, questionText, innerWidth);
        const questionHeight = questionLines.length * baseQuestionLineHeight * textScale;
        context.font = `600 ${baseOptionFont * textScale}px Manrope, sans-serif`;
        optionLayouts = question.options.map((option) => {
          const lines = getWrappedLines(context, plainText(option.answerHtml), innerWidth - 44);
          const lineHeight = baseOptionLineHeight * textScale;
          return {
            lines,
            lineHeight,
            height: Math.max(minimumOptionHeight * textScale, lines.length * lineHeight + 30 * textScale),
          };
        });
        const contentHeight =
          questionHeight +
          (isCompact ? (isPortrait ? 22 : 16) : 26) * textScale +
          optionLayouts.reduce((total, option) => total + option.height, 0) +
          optionGap * textScale * (question.options.length - 1);
        if (contentHeight <= availableTextHeight || textScale <= 0.35) {
          break;
        }
        textScale -= 0.05;
      } while (true);

      context.fillStyle = "#1f2a17";
      context.font = `700 ${baseQuestionFont * textScale}px Manrope, sans-serif`;
      let nextY = drawWrappedText(
        context,
        questionText,
        textX,
        questionTop,
        innerWidth,
        baseQuestionLineHeight * textScale,
      );
      nextY += (isCompact ? (isPortrait ? 22 : 16) : 26) * textScale;

      const selectedAnswerId = activeSession.selectedAnswers[question.id];
      question.options.forEach((option, optionIndex) => {
        const optionLayout = optionLayouts[optionIndex];
        const isCorrect = revealed && option.isRight;
        const isSelected = selectedAnswerId === option.id;
        context.fillStyle = isCorrect ? "#3c7a24" : isSelected ? "#dff1c9" : "#fbfcf8";
        context.beginPath();
        context.roundRect(textX, nextY, innerWidth, optionLayout.height, 18);
        context.fill();
        context.fillStyle = isCorrect ? "#ffffff" : "#1f2a17";
        context.font = `600 ${baseOptionFont * textScale}px Manrope, sans-serif`;
        drawWrappedText(
          context,
          plainText(option.answerHtml),
          textX + 22,
          nextY +
            optionLayout.height / 2 -
            ((optionLayout.lines.length - 1) * optionLayout.lineHeight) / 2 +
            (isCompact ? 9 : 11) * textScale,
          innerWidth - 44,
          optionLayout.lineHeight,
        );
        nextY += optionLayout.height + optionGap * textScale;
      });
      context.restore();

      if (isActive && !revealed) {
        drawTimerBadge(top);
      }
    };

    let cardTop = listTop - animationProgress * (activeCardHeight + cardGap);
    questions.forEach((question, index) => {
      const cardHeight = index === 0 ? activeCardHeight : waitingCardHeight;
      drawQuestionCard(question, index, cardTop, cardHeight, index === 0 ? 1 - animationProgress : 1);
      cardTop += cardHeight + cardGap;
    });
  }

  function stopQuestionRecording({ download = true, updateState = true } = {}) {
    const recording = recordingRef.current;
    if (!recording || recording.stopping) {
      return;
    }

    recording.stopping = true;
    stopNarration();
    recording.download = download;
    window.clearInterval(recording.frameInterval);
    if (recording.backgroundMusic) {
      const { audio, gain, source } = recording.backgroundMusic;
      audio.pause();
      audio.currentTime = 0;
      source.disconnect();
      gain.disconnect();
    }
    if (recording.audioDestination) {
      recording.audioDestination.stream.getTracks().forEach((track) => track.stop());
    }
    if (recording.audioContext) {
      recording.audioContext.close();
    }
    recording.recorders.forEach(({ recorder }) => {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    });
    recordingRef.current = null;

    if (updateState) {
      setRecordingState(download ? "saved" : "idle");
    }
  }

  async function startQuestionRecording({ subjectName, syllabusName }) {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      setRecordingState("unsupported");
      return;
    }

    stopQuestionRecording({ download: true, updateState: false });

    const activeSession = sessionRef.current;
    const includeMusic = activeSession?.videoAudioMode !== "voice";
    const includeVoice = activeSession?.narrateVideo;
    let audioContext = null;
    let audioDestination = null;
    let backgroundMusic = null;
    try {
      if ((includeMusic || includeVoice) && window.AudioContext) {
        audioContext = new AudioContext();
        audioDestination = audioContext.createMediaStreamDestination();
        await audioContext.resume();
      }

      if (includeMusic && audioContext && audioDestination) {
        const response = await fetch("/api/music");
        const { tracks = [] } = await response.json();
        const selectedTrack = tracks[Math.floor(Math.random() * tracks.length)];

        if (selectedTrack?.url) {
          const audio = new Audio(selectedTrack.url);
          const source = audioContext.createMediaElementSource(audio);
          const gain = audioContext.createGain();
          gain.gain.value = activeSession?.musicVolume ?? 0.25;
          source.connect(gain).connect(audioDestination);
          audio.loop = true;
          audio.preload = "auto";
          await audio.play();
          backgroundMusic = { audio, gain, source };
        }
      }
    } catch {
      // Music is optional: still create the quiz video if a file cannot play.
    }

    const formats = [
      { ratio: "16x9", aspect: "landscape", width: 1920, height: 1080 },
      { ratio: "9x16", aspect: "portrait", width: 1080, height: 1920 },
    ];
    const mimeType = ["video/webm;codecs=vp9", "video/webm", "video/mp4"].find(
      (type) => MediaRecorder.isTypeSupported(type),
    );
    const recording = {
      recorders: [],
      frameInterval: null,
      stopping: false,
      download: true,
      backgroundMusic,
      audioContext,
      audioDestination,
      voiceVolume: activeSession?.voiceVolume ?? 1,
    };

    formats.forEach((format) => {
      const canvas = document.createElement("canvas");
      canvas.width = format.width;
      canvas.height = format.height;
      const chunks = [];
      const recordingStream = canvas.captureStream(30);
      audioDestination?.stream.getAudioTracks().forEach((track) => {
        recordingStream.addTrack(track);
      });
      const recorder = new MediaRecorder(
        recordingStream,
        {
          ...(mimeType ? { mimeType } : {}),
          videoBitsPerSecond: 12_000_000,
        },
      );

      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        if (!recording.download || !chunks.length) {
          return;
        }

        const video = new Blob(chunks, { type: mimeType || "video/webm" });
        const downloadLink = document.createElement("a");
        downloadLink.href = URL.createObjectURL(video);
        const safeNamePart = (value) =>
          String(value || "Quiz")
            .replace(/[\\/:*?"<>|]/g, "")
            .replace(/\s+/g, " ")
            .trim();
        downloadLink.download = `${safeNamePart(subjectName)} ${safeNamePart(
          syllabusName,
        )} ${format.ratio}.${
          mimeType?.includes("mp4") ? "mp4" : "webm"
        }`;
        downloadLink.click();
        window.setTimeout(() => URL.revokeObjectURL(downloadLink.href), 1000);
      };

      recording.recorders.push({ canvas, format, recorder });
    });

    const renderFrames = () => {
      recording.recorders.forEach(({ canvas, format }) => {
        drawQuestionFrame(canvas, format.aspect);
      });
    };

    renderFrames();
    recording.recorders.forEach(({ recorder }) => recorder.start(1000));
    recording.frameInterval = window.setInterval(renderFrames, 1000 / 30);
    recordingRef.current = recording;
    setRecordingState("recording");

    if (activeSession?.narrateVideo && activeSession.questions[0]) {
      const narrationSession = { ...activeSession, narrationStatus: "playing" };
      sessionRef.current = narrationSession;
      setSession(narrationSession);
      void narrateQuestion(
        narrationSession.questions[0],
        1,
        narrationSession.voiceName,
        recording,
        () => {
          const current = sessionRef.current;
          if (
            !current ||
            current.completed ||
            current.activeQuestionIndex !== 0 ||
            current.narrationStatus !== "playing"
          ) {
            return;
          }

          const readySession = { ...current, narrationStatus: "ready" };
          sessionRef.current = readySession;
          setSession(readySession);
        },
      );
    }
  }

  useEffect(() => {
    return () => stopQuestionRecording({ download: false, updateState: false });
  }, []);

  useEffect(() => {
    if (session?.completed && recordingRef.current) {
      stopQuestionRecording();
    }
  }, [session?.completed]);

  /*
   * ============================================================
   * LOAD SUBJECTS
   * ============================================================
   */
  useEffect(() => {
    fetch("/api/subjects")
      .then((res) => res.json())
      .then((data) => {
        setSubjects(data.subjects || []);
      })
      .catch(() => {
        setQuizState((current) => ({
          ...current,
          error: "Unable to load subjects.",
        }));
      });
  }, []);

  /*
   * ============================================================
   * LOAD SYLLABUSES
   * ============================================================
   */
  useEffect(() => {
    if (!form.subjectId) {
      setSyllabuses([]);

      setForm((current) => ({
        ...current,
        syllabusId: "",
      }));

      return;
    }

    fetch(`/api/syllabuses?subject_id=${form.subjectId}`)
      .then((res) => res.json())
      .then((data) => {
        setSyllabuses(data.syllabuses || []);

        setForm((current) => ({
          ...current,
          syllabusId: "",
        }));
      })
      .catch(() => {
        setQuizState((current) => ({
          ...current,
          error: "Unable to load syllabuses.",
        }));
      });
  }, [form.subjectId]);

  /*
   * ============================================================
   * CURRENT QUESTION
   * ============================================================
   */
  const currentQuestion = useMemo(() => {
    if (!session) {
      return null;
    }

    return session.questions[session.activeQuestionIndex] || null;
  }, [session]);

  useEffect(() => {
    if (
      !session?.narrateVideo ||
      !recordingRef.current ||
      !currentQuestion ||
      session.completed ||
      session.pendingAdvance ||
      session.advancingQuestionId ||
      session.narrationStatus !== "waiting"
    ) {
      return;
    }

    narrateQuestion(
      currentQuestion,
      session.activeQuestionIndex + 1,
      session.voiceName,
      recordingRef.current,
      () => {
        setSession((current) => {
          if (
            !current ||
            current.completed ||
            current.activeQuestionIndex !== session.activeQuestionIndex ||
            current.narrationStatus !== "waiting"
          ) {
            return current;
          }

          return { ...current, narrationStatus: "ready" };
        });
      },
    );
  }, [
    currentQuestion?.id,
    session?.activeQuestionIndex,
    session?.advancingQuestionId,
    session?.completed,
    session?.narrateVideo,
    session?.narrationStatus,
    session?.pendingAdvance,
    session?.voiceName,
    recordingState,
  ]);

  /*
   * ============================================================
   * TIMER CLOCK
   * ============================================================
   */
  function TimerClock({ remaining, total, isActive }) {
    const radius = 48;
    const stroke = 15;

    const normalizedRadius = radius - stroke * 0.5;

    const circumference = 2 * Math.PI * normalizedRadius;

    const progress = total ? Math.max(0, Math.min(1, remaining / total)) : 0;

    const offset = circumference - progress * circumference;

    const [pulseKey, setPulseKey] = useState(0);

    const prev = useRef(remaining);

    useEffect(() => {
      if (prev.current !== remaining) {
        setPulseKey((key) => key + 1);
        prev.current = remaining;
      }
    }, [remaining]);

    return (
      <div
        className={`timer-clock ${isActive ? "active" : "idle"}`}
        key={pulseKey}
      >
        <svg
          height={radius * 2}
          width={radius * 2}
          className="timer-svg"
          viewBox={`0 0 ${radius * 2} ${radius * 2}`}
        >
          <g transform={`rotate(-90 ${radius} ${radius})`}>
            <circle
              stroke="#eee"
              fill="transparent"
              strokeWidth={stroke}
              r={normalizedRadius}
              cx={radius}
              cy={radius}
            />

            <circle
              className="progress"
              stroke="#4f46e5"
              fill="transparent"
              strokeWidth={stroke}
              strokeLinecap="round"
              r={normalizedRadius}
              cx={radius}
              cy={radius}
              strokeDasharray={`${circumference} ${circumference}`}
              strokeDashoffset={offset}
            />
          </g>
        </svg>

        <div className={`timer-number ${isActive ? "pulse" : ""}`}>
          {remaining}s
        </div>
      </div>
    );
  }

  /*
   * ============================================================
   * TIMER
   *
   * Timer runs only for the active question.
   *
   * When answer is revealed:
   * - timer stops
   * - 2 second delay starts
   * ============================================================
   */
  useEffect(() => {
    if (!session || !currentQuestion) {
      return;
    }

    /*
     * Don't run timer after quiz completion.
     */
    if (session.completed) {
      return;
    }

    /*
     * Don't run timer while answer is being shown.
     */
    if (session.revealedQuestionIds.includes(currentQuestion.id)) {
      return;
    }

    /*
     * Don't run timer while waiting to
     * advance to next question.
     */
    if (session.pendingAdvance) {
      return;
    }

    if (session.narrationStatus !== "ready") {
      return;
    }

    /*
     * Start timer for the current question.
     */
    setRemainingSeconds(session.timerSeconds);

    const intervalId = window.setInterval(() => {
      setRemainingSeconds((seconds) => {
        if (seconds <= 1) {
          window.clearInterval(intervalId);

          revealCurrentQuestion();

          return 0;
        }

        return seconds - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    currentQuestion?.id,
    session?.timerSeconds,
    session?.completed,
    session?.pendingAdvance,
    session?.narrationStatus,
    session?.revealedQuestionIds,
  ]);

  /*
   * ============================================================
   * ADVANCE TO NEXT QUESTION
   *
   * Answer shown
   *      ↓
   * Wait 2 seconds
   *      ↓
   * Collapse current question upward
   *      ↓
   * Next question scrolls into place
   * ============================================================
   */
  useEffect(() => {
    if (!session || !session.pendingAdvance) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSession((current) => {
        if (!current) {
          return current;
        }

        const nextIndex = current.activeQuestionIndex + 1;

        /*
         * Last question.
         */
        if (nextIndex >= current.questions.length) {
          return {
            ...current,
            pendingAdvance: false,
            completed: true,
          };
        }

        /* Start the upward-collapse animation before changing the list. */
        advanceAnimationStartedAtRef.current = performance.now();
        return {
          ...current,
          advancingQuestionId:
            current.questions[current.activeQuestionIndex].id,
        };
      });
    }, 2000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [session?.pendingAdvance]);

  /*
   * Keep the answered card mounted while it collapses. Once its space has
   * closed, advancing the index leaves the next card already at the top.
   */
  useEffect(() => {
    if (!session?.advancingQuestionId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSession((current) => {
        if (!current || !current.advancingQuestionId) {
          return current;
        }

        return {
          ...current,
          activeQuestionIndex: current.activeQuestionIndex + 1,
          pendingAdvance: false,
          advancingQuestionId: null,
          narrationStatus: current.narrateVideo ? "waiting" : "ready",
        };
      });

      setRemainingSeconds(0);
    }, 480);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [session?.advancingQuestionId]);

  /*
   * ============================================================
   * FORM UPDATE
   * ============================================================
   */
  function updateField(event) {
    const { name, value, type, checked } = event.target;

    setForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  function drawFacebookQuizImage(question, subject, imageFormat) {
    const canvas = document.createElement("canvas");
    canvas.width = imageFormat.width;
    canvas.height = imageFormat.height;
    const context = canvas.getContext("2d");
    const paletteHue = Math.floor(Math.random() * 360);
    const theme = {
      start: `hsl(${paletteHue} 78% 92%)`,
      end: `hsl(${(paletteHue + 52) % 360} 72% 72%)`,
      accent: `hsl(${paletteHue} 62% 30%)`,
      highlight: `hsl(${(paletteHue + 160) % 360} 86% 56%)`,
    };
    const isPortrait = canvas.height > canvas.width;
    const padding = isPortrait ? 42 : 54;
    const cardX = padding;
    const cardY = isPortrait ? 116 : 76;
    const cardWidth = canvas.width - padding * 2;
    const cardHeight = canvas.height - cardY - (isPortrait ? 58 : 44);
    const questionText = plainText(question.questionHtml);

    const background = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    background.addColorStop(0, theme.start);
    background.addColorStop(1, theme.end);
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = "rgba(255, 255, 255, 0.3)";
    context.beginPath();
    context.arc(canvas.width - 74, 76, 150, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.arc(90, 600, 130, 0, Math.PI * 2);
    context.fill();

    const drawStar = (x, y, radius, color) => {
      context.save();
      context.translate(x, y);
      context.fillStyle = color;
      context.beginPath();
      for (let point = 0; point < 10; point += 1) {
        const angle = -Math.PI / 2 + (point * Math.PI) / 5;
        const distance = point % 2 === 0 ? radius : radius * 0.42;
        const starX = Math.cos(angle) * distance;
        const starY = Math.sin(angle) * distance;
        if (point === 0) {
          context.moveTo(starX, starY);
        } else {
          context.lineTo(starX, starY);
        }
      }
      context.closePath();
      context.fill();
      context.restore();
    };

    const drawPencil = (x, y, rotation) => {
      context.save();
      context.translate(x, y);
      context.rotate(rotation);
      context.fillStyle = "rgba(255, 227, 95, 0.92)";
      context.fillRect(-14, -72, 28, 125);
      context.fillStyle = "rgba(248, 113, 113, 0.9)";
      context.fillRect(-14, 42, 28, 15);
      context.fillStyle = "rgba(255, 244, 214, 0.92)";
      context.beginPath();
      context.moveTo(-14, -72);
      context.lineTo(14, -72);
      context.lineTo(0, -98);
      context.closePath();
      context.fill();
      context.fillStyle = "rgba(55, 65, 81, 0.88)";
      context.beginPath();
      context.arc(0, -91, 4, 0, Math.PI * 2);
      context.fill();
      context.restore();
    };

    const drawBooks = (x, y) => {
      const bookColors = ["#60a5fa", "#f97316", "#34d399"];
      bookColors.forEach((color, index) => {
        const offsetY = index * 20;
        context.fillStyle = color;
        context.beginPath();
        context.roundRect(x, y - offsetY, 90 - index * 8, 18, 5);
        context.fill();
        context.fillStyle = "rgba(255, 255, 255, 0.45)";
        context.fillRect(x + 12, y - offsetY + 4, 40, 3);
      });
    };

    drawPencil(isPortrait ? 88 : 58, isPortrait ? 130 : 160, -0.4);
    drawPencil(canvas.width - (isPortrait ? 80 : 52), canvas.height - 116, 0.46);
    drawBooks(isPortrait ? canvas.width - 150 : canvas.width - 116, isPortrait ? 94 : 42);
    drawBooks(30, canvas.height - 40);

    context.shadowColor = "rgba(31, 42, 23, 0.18)";
    context.shadowBlur = 30;
    context.shadowOffsetY = 16;
    context.fillStyle = "rgba(255, 255, 255, 0.92)";
    context.beginPath();
    context.roundRect(cardX, cardY, cardWidth, cardHeight, 34);
    context.fill();
    context.shadowColor = "transparent";

    context.fillStyle = theme.accent;
    context.font = "800 21px Manrope, sans-serif";
    context.fillText("QUICK QUIZ", cardX + 42, cardY + 52);
    context.fillStyle = theme.highlight;
    context.beginPath();
    context.arc(cardX + 218, cardY + 45, 15, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#ffffff";
    context.font = "800 21px Manrope, sans-serif";
    context.textAlign = "center";
    context.fillText("?", cardX + 218, cardY + 53);
    context.textAlign = "left";
    context.textAlign = "right";
    context.fillStyle = "#60705a";
    context.font = "700 17px Manrope, sans-serif";
    context.fillText(subject?.subName || "TOP QUESTIONS", cardX + cardWidth - 42, cardY + 52);
    context.textAlign = "left";

    let fontSize = isPortrait ? 38 : 38;
    let questionLines = [];
    const questionWidth = cardWidth - 84;
    do {
      context.font = `800 ${fontSize}px Manrope, sans-serif`;
      questionLines = getWrappedLines(context, questionText, questionWidth);
      if (questionLines.length <= 3 || fontSize <= 25) {
        break;
      }
      fontSize -= 2;
    } while (true);

    context.fillStyle = "#1f2a17";
    context.font = `800 ${fontSize}px Manrope, sans-serif`;
    let optionY = cardY + 108;
    questionLines.forEach((line) => {
      context.fillText(line, cardX + 42, optionY);
      optionY += fontSize * 1.2;
    });
    optionY += 22;

    const optionGap = 14;
    const optionHeight = Math.min(
      isPortrait ? 92 : 68,
      (cardY + cardHeight - 34 - optionY - optionGap * 3) / 4,
    );
    question.options.slice(0, 4).forEach((option, index) => {
      const optionText = plainText(option.answerHtml);
      const optionX = cardX + 42;
      const optionWidth = cardWidth - 84;
      context.fillStyle = index % 2 === 0
        ? `hsl(${paletteHue} 46% 96%)`
        : `hsl(${(paletteHue + 30) % 360} 52% 94%)`;
      context.beginPath();
      context.roundRect(optionX, optionY, optionWidth, optionHeight, 16);
      context.fill();
      context.fillStyle = theme.accent;
      context.beginPath();
      context.arc(optionX + 26, optionY + optionHeight / 2, 14, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#ffffff";
      context.font = "800 16px Manrope, sans-serif";
      context.textAlign = "center";
      context.fillText(String.fromCharCode(65 + index), optionX + 26, optionY + optionHeight / 2 + 6);
      context.textAlign = "left";
      context.fillStyle = "#1f2a17";
      context.font = `700 ${isPortrait ? 23 : 22}px Manrope, sans-serif`;
      const optionLines = getWrappedLines(context, optionText, optionWidth - 80).slice(0, 2);
      const optionLineHeight = isPortrait ? 27 : 25;
      const optionTextY = optionY + optionHeight / 2 - ((optionLines.length - 1) * optionLineHeight) / 2 + 8;
      optionLines.forEach((line, lineIndex) => {
        context.fillText(line, optionX + 58, optionTextY + lineIndex * optionLineHeight);
      });
      optionY += optionHeight + optionGap;
    });

    return canvas;
  }

  function drawFacebookAnswerImage(question, subject, imageFormat) {
    const canvas = document.createElement("canvas");
    canvas.width = imageFormat.width;
    canvas.height = imageFormat.height;
    const context = canvas.getContext("2d");
    const isPortrait = canvas.height > canvas.width;
    const correctAnswer = question.options.find((option) => option.isRight);
    const answerText = correctAnswer ? plainText(correctAnswer.answerHtml) : "Correct answer unavailable";
    const descriptionText = plainText(question.descriptionHtml);
    const questionText = plainText(question.questionHtml);
    const hue = Math.floor(Math.random() * 360);
    const padding = isPortrait ? 46 : 56;
    const cardX = padding;
    const cardY = isPortrait ? 118 : 62;
    const cardWidth = canvas.width - padding * 2;
    const cardHeight = canvas.height - cardY - (isPortrait ? 58 : 48);

    const background = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    background.addColorStop(0, `hsl(${hue} 67% 20%)`);
    background.addColorStop(0.55, `hsl(${(hue + 36) % 360} 67% 31%)`);
    background.addColorStop(1, `hsl(${(hue + 78) % 360} 65% 20%)`);
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = "rgba(255, 255, 255, 0.08)";
    context.beginPath();
    context.arc(canvas.width - 38, 28, isPortrait ? 190 : 125, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.arc(36, canvas.height - 14, isPortrait ? 165 : 110, 0, Math.PI * 2);
    context.fill();

    context.shadowColor = "rgba(0, 0, 0, 0.25)";
    context.shadowBlur = 30;
    context.shadowOffsetY = 14;
    context.fillStyle = "rgba(255, 255, 255, 0.96)";
    context.beginPath();
    context.roundRect(cardX, cardY, cardWidth, cardHeight, 34);
    context.fill();
    context.shadowColor = "transparent";

    context.fillStyle = `hsl(${(hue + 84) % 360} 76% 43%)`;
    context.beginPath();
    context.roundRect(cardX + 34, cardY + 30, isPortrait ? 228 : 212, 44, 22);
    context.fill();
    context.fillStyle = "#ffffff";
    context.font = "800 18px Manrope, sans-serif";
    context.textAlign = "center";
    context.fillText("✓  ANSWER REVEAL", cardX + (isPortrait ? 148 : 140), cardY + 59);
    context.textAlign = "left";

    context.fillStyle = "#61706b";
    context.font = "700 17px Manrope, sans-serif";
    context.textAlign = "right";
    context.fillText(subject?.subName || "QUICK QUIZ", cardX + cardWidth - 38, cardY + 58);
    context.textAlign = "left";

    const innerX = cardX + 42;
    const innerWidth = cardWidth - 84;
    const answerTop = cardY + 128;
    context.fillStyle = "#65716d";
    context.font = `800 ${isPortrait ? 18 : 16}px Manrope, sans-serif`;
    context.fillText("THE CORRECT ANSWER", innerX, answerTop);

    let answerFontSize = isPortrait ? 51 : 42;
    let answerLines = [];
    const maxAnswerHeight = descriptionText
      ? (isPortrait ? 238 : 150)
      : Number.POSITIVE_INFINITY;
    do {
      context.font = `800 ${answerFontSize}px Manrope, sans-serif`;
      answerLines = getWrappedLines(context, answerText, innerWidth - 52);
      const answerHeight = answerLines.length * answerFontSize * 1.14 + 54;
      if (
        (answerLines.length <= (isPortrait ? 3 : 2) && answerHeight <= maxAnswerHeight) ||
        answerFontSize <= 16
      ) {
        break;
      }
      answerFontSize -= 2;
    } while (true);

    const answerLineHeight = answerFontSize * 1.14;
    const answerBoxY = answerTop + 28;
    const answerBoxHeight = Math.max(isPortrait ? 132 : 108, answerLines.length * answerLineHeight + 54);
    context.fillStyle = `hsl(${(hue + 84) % 360} 74% 94%)`;
    context.beginPath();
    context.roundRect(innerX, answerBoxY, innerWidth, answerBoxHeight, 22);
    context.fill();
    context.fillStyle = `hsl(${(hue + 84) % 360} 69% 30%)`;
    context.beginPath();
    context.roundRect(innerX, answerBoxY, 12, answerBoxHeight, 6);
    context.fill();
    context.fillStyle = "#17251f";
    context.font = `800 ${answerFontSize}px Manrope, sans-serif`;
    const answerTextY = answerBoxY + answerBoxHeight / 2 - ((answerLines.length - 1) * answerLineHeight) / 2 + answerFontSize * 0.36;
    answerLines.forEach((line, index) => {
      context.fillText(line, innerX + 32, answerTextY + index * answerLineHeight);
    });

    const remainingHeight = cardY + cardHeight - (answerBoxY + answerBoxHeight) - 48;
    const supportingText = descriptionText || questionText;
    const supportingLabel = descriptionText ? "WHY THIS IS THE ANSWER" : "QUESTION";
    if (supportingText && remainingHeight > 65) {
      const supportTop = answerBoxY + answerBoxHeight + 44;
      context.fillStyle = "#65716d";
      context.font = `800 ${isPortrait ? 18 : 16}px Manrope, sans-serif`;
      context.fillText(supportingLabel, innerX, supportTop);

      let supportFontSize = isPortrait ? 28 : 24;
      let supportLines = [];
      const maxSupportLines = Math.max(2, Math.floor((remainingHeight - 30) / (supportFontSize * 1.35)));
      do {
        context.font = `600 ${supportFontSize}px Manrope, sans-serif`;
        supportLines = getWrappedLines(context, supportingText, innerWidth);
        if (supportLines.length <= maxSupportLines || supportFontSize <= 17) {
          break;
        }
        supportFontSize -= 1;
      } while (true);
      const supportLineHeight = supportFontSize * 1.35;
      const availableLines = Math.max(1, Math.floor((remainingHeight - 30) / supportLineHeight));
      context.fillStyle = "#31423b";
      context.font = `600 ${supportFontSize}px Manrope, sans-serif`;
      supportLines.slice(0, availableLines).forEach((line, index) => {
        context.fillText(line, innerX, supportTop + 34 + index * supportLineHeight);
      });
    }

    return canvas;
  }

  function downloadCanvasImage(canvas, filename) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((image) => {
        if (!image) {
          reject(new Error("Unable to create the quiz image."));
          return;
        }
        const link = document.createElement("a");
        const imageUrl = URL.createObjectURL(image);
        link.href = imageUrl;
        link.download = filename;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(imageUrl), 1_000);
        resolve();
      }, "image/png");
    });
  }

  async function generateFacebookQuizImage() {
    if (!form.subjectId || !form.syllabusId) {
      setFacebookImageError("Select a subject and syllabus first.");
      return;
    }

    setIsFacebookImageGenerating(true);
    setFacebookImageError("");
    try {
      const response = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: Number(form.subjectId),
          syllabusId: Number(form.syllabusId),
          questionCount: 1,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.questions?.length) {
        throw new Error(data.error || "No question is available for this selection.");
      }

      const subject = subjects.find((item) => item.id === Number(form.subjectId));
      const imageFormat = FACEBOOK_IMAGE_FORMATS[form.facebookImageFormat];
      const question = data.questions[0];
      const filePrefix = `${String(subject?.subName || "Quiz").replace(/[^a-z0-9]+/gi, "-")}`;
      await Promise.all([
        downloadCanvasImage(
          drawFacebookQuizImage(question, subject, imageFormat),
          `${filePrefix} Quiz Question ${imageFormat.width}x${imageFormat.height}.png`,
        ),
        downloadCanvasImage(
          drawFacebookAnswerImage(question, subject, imageFormat),
          `${filePrefix} Quiz Answer ${imageFormat.width}x${imageFormat.height}.png`,
        ),
      ]);
    } catch (error) {
      setFacebookImageError(error.message || "Unable to generate the quiz image.");
    } finally {
      setIsFacebookImageGenerating(false);
    }
  }

  /*
   * ============================================================
   * START QUIZ
   * ============================================================
   */
  function startQuiz(event) {
    event.preventDefault();
    setIsVoicePreviewPlaying(false);
    stopNarration();
    stopAudioPreview();

    setQuizState({
      loading: true,
      error: "",
      availableCount: 0,
      questions: [],
    });

    fetch("/api/quiz", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subjectId: Number(form.subjectId),
        syllabusId: Number(form.syllabusId),
        questionCount: Number(form.questionCount),
      }),
    })
      .then((res) => res.json())
      .then(async (data) => {
        if (data.error) {
          throw new Error(data.error);
        }

        if (!data.questions?.length) {
          throw new Error("No questions found for this selection.");
        }

        const selectedSubject = subjects.find(
          (subject) => subject.id === Number(form.subjectId),
        );
        const selectedSyllabus = syllabuses.find(
          (syllabus) => syllabus.id === Number(form.syllabusId),
        );
        const newSession = {
          questions: data.questions,

          videoTheme: getVideoTheme(selectedSubject),
          videoTitle: [selectedSubject?.subName, selectedSyllabus?.syllabus]
            .filter(Boolean)
            .join(" - "),
          subjectName: selectedSubject?.subName || "Top Questions",
          syllabusName: selectedSyllabus?.syllabus || "General",

          perPage: Number(form.perPage),

          timerSeconds: Number(form.timerSeconds),

          narrateVideo:
            form.recordVideo &&
            form.videoAudioMode !== "music" &&
            form.narrateVideo &&
            speechVoices.length > 0,
          voiceName: form.voiceName,
          videoAudioMode: form.videoAudioMode,
          musicVolume: Number(form.musicVolume),
          voiceVolume: Number(form.voiceVolume),
          narrationStatus:
            form.recordVideo &&
            form.videoAudioMode !== "music" &&
            form.narrateVideo &&
            speechVoices.length > 0
              ? "waiting"
              : "ready",

          activeQuestionIndex: 0,

          selectedAnswers: {},

          /*
           * Questions whose answers
           * have been revealed.
           */
          revealedQuestionIds: [],

          /*
           * True during the 2 second
           * answer display period.
           */
          pendingAdvance: false,

          /* Question currently collapsing out of view. */
          advancingQuestionId: null,

          completed: false,

          /*
           * When true, all questions
           * are displayed again.
           */
          showAllQuestions: false,
        };

        narrationCacheRef.current.clear();
        revealingQuestionIdsRef.current.clear();
        if (newSession.narrateVideo) {
          try {
            await getNarrationAudio(
              questionNarrationText(newSession.questions[0], 1),
              newSession.voiceName,
            );
          } catch {
            // Start the quiz without a cached first narration if Edge TTS is unavailable.
          }
          prefetchQuestionNarration(newSession.questions[0], 1, newSession.voiceName);
        }

        setQuizState({
          loading: false,
          error: "",
          availableCount: data.availableCount,
          questions: data.questions,
        });
        sessionRef.current = newSession;
        remainingSecondsRef.current = newSession.narrationStatus === "ready"
          ? Number(form.timerSeconds)
          : 0;
        setSession(newSession);

        setRemainingSeconds(remainingSecondsRef.current);
        if (form.recordVideo) {
          void startQuestionRecording({
            subjectName: selectedSubject?.subName,
            syllabusName: selectedSyllabus?.syllabus,
          });
        } else {
          setRecordingState("idle");
        }
      })
      .catch((error) => {
        setSession(null);

        setRemainingSeconds(0);

        setQuizState({
          loading: false,
          error: error.message || "Unable to start quiz.",
          availableCount: 0,
          questions: [],
        });
      });
  }

  /*
   * ============================================================
   * CHOOSE ANSWER
   * ============================================================
   */
  function chooseAnswer(questionId, answerId) {
    if (!session) {
      return;
    }

    /*
     * Don't allow answer selection
     * after answer is revealed.
     */
    if (session.revealedQuestionIds.includes(questionId)) {
      return;
    }

    /*
     * Only active question can be answered.
     */
    const activeQuestion = session.questions[session.activeQuestionIndex];

    if (!activeQuestion || activeQuestion.id !== questionId) {
      return;
    }

    /*
     * Don't allow answer changes
     * during answer display.
     */
    if (session.pendingAdvance) {
      return;
    }

    /*
     * Don't allow changes after
     * quiz completion.
     */
    if (session.completed) {
      return;
    }

    setSession((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,

        selectedAnswers: {
          ...current.selectedAnswers,

          [questionId]: answerId,
        },
      };
    });
  }

  /*
   * ============================================================
   * REVEAL CURRENT QUESTION
   * ============================================================
   */
  function revealCurrentQuestion() {
    const activeSession = sessionRef.current;
    const question = activeSession?.questions[activeSession.activeQuestionIndex];
    if (!activeSession || !question || activeSession.revealedQuestionIds.includes(question.id)) {
      return;
    }
    if (revealingQuestionIdsRef.current.has(question.id)) {
      return;
    }
    revealingQuestionIdsRef.current.add(question.id);

    const shouldNarrateAnswer = activeSession.narrateVideo && recordingRef.current;
    const revealedSession = {
      ...activeSession,
      revealedQuestionIds: [...activeSession.revealedQuestionIds, question.id],
      pendingAdvance: !shouldNarrateAnswer,
      narrationStatus: shouldNarrateAnswer ? "answer" : activeSession.narrationStatus,
    };
    sessionRef.current = revealedSession;
    setSession(revealedSession);

    if (shouldNarrateAnswer) {
      void narrateCorrectAnswer(
        question,
        activeSession.voiceName,
        recordingRef.current,
        () => {
          const current = sessionRef.current;
          if (!current || !current.revealedQuestionIds.includes(question.id)) {
            return;
          }
          const answerCompleteSession = {
            ...current,
            narrationStatus: "ready",
            pendingAdvance: true,
          };
          sessionRef.current = answerCompleteSession;
          setSession(answerCompleteSession);
        },
      );
    }
  }

  /*
   * ============================================================
   * SHOW ALL QUESTIONS
   * ============================================================
   */
  function showAllQuestions() {
    setSession((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        showAllQuestions: true,
        completed: true,
        pendingAdvance: false,
      };
    });

    setRemainingSeconds(0);
  }

  /*
   * ============================================================
   * RESET QUIZ
   * ============================================================
   */
  function resetQuiz() {
    stopQuestionRecording();
    narrationCacheRef.current.clear();
    revealingQuestionIdsRef.current.clear();
    setSession(null);
    setRemainingSeconds(0);
  }

  /*
   * ============================================================
   * VISIBLE QUESTIONS
   *
   * IMPORTANT:
   *
   * Normal quiz:
   *
   *   [Current question]
   *   [Question below]
   *   [Question below]
   *   [Question below]
   *
   * After current question is completed:
   *
   *   current question collapses upward
   *
   *   [Next question]
   *   [Question below]
   *   [Question below]
   *
   * ============================================================
   */
  const visibleQuestions = useMemo(() => {
    if (!session) {
      return [];
    }

    /*
     * Show everything after clicking
     * "Show All Questions".
     */
    if (session.showAllQuestions) {
      return session.questions;
    }

    /*
     * Quiz completed:
     * hide question list until
     * Show All Questions is clicked.
     */
    if (session.completed) {
      return [];
    }

    /*
     * IMPORTANT:
     *
     * Start from activeQuestionIndex.
     *
     * This means questions BELOW the
     * active question remain visible.
     *
   * The previous question stays mounted briefly while its exit animation runs.
     */
    return session.questions.slice(session.activeQuestionIndex);
  }, [session]);

  /*
   * ============================================================
   * SCORE
   * ============================================================
   */
  const score = useMemo(() => {
    if (!session) {
      return 0;
    }

    return session.questions.reduce((total, question) => {
      const selected = session.selectedAnswers[question.id];

      const correct = question.options.find((option) => option.isRight);

      if (selected && correct && selected === correct.id) {
        return total + 1;
      }

      return total;
    }, 0);
  }, [session]);

  /*
   * ============================================================
   * CURRENT QUESTION NUMBER
   * ============================================================
   */
  const currentQuestionNumber = session
    ? Math.min(session.activeQuestionIndex + 1, session.questions.length)
    : 0;

  /*
   * ============================================================
   * RENDER
   * ============================================================
   */
  return (
    <main className="shell">
      <style>{`
        .timer-wrapper {
          position: absolute;
          top: 8px;
          right: 14px;
          z-index: 2;
          pointer-events: none;
        }

        .timer-clock {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          padding: 8px 15px 8px 8px;
          border: 2px solid rgba(249, 115, 22, 0.52);
          border-radius: 999px;
          color: #9a3412;
          background: linear-gradient(135deg, #fef3c7 0%, #fde68a 45%, #fbcfe8 100%);
          box-shadow:
            0 8px 20px rgba(249, 115, 22, 0.28),
            0 0 0 4px rgba(254, 240, 138, 0.45);
        }

        .timer-svg {
          width: 52px;
          height: 52px;
          display: block;
        }

        .timer-clock .progress {
          stroke: #ea580c;
        }

        .timer-clock .progress {
          transition:
            stroke-dashoffset
            0.5s linear;
        }

        .timer-number {
          font-weight: 800;
          font-size: 1.8rem;
          line-height: 1;
          min-width: 48px;
          text-align: center;
          display: inline-block;
        }

        .pulse {
          animation:
            pulse
            0.6s ease-out;
        }

        @keyframes pulse {
          0% {
            transform: scale(1);
          }

          50% {
            transform: scale(1.18);
          }

          100% {
            transform: scale(1);
          }
        }

        .answer-shown {
          font-weight: 700;
          color: #16a34a;
        }

        .recording-button {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          border: 0;
          border-radius: 999px;
          color: #ffffff;
          font: inherit;
          font-weight: 800;
          cursor: pointer;
          background: #b23f3f;
          box-shadow: 0 6px 16px rgba(178, 63, 63, 0.22);
        }

        .recording-choice {
          display: flex !important;
          align-items: center;
          gap: 12px;
          padding: 14px;
          border: 1px solid rgba(93, 159, 61, 0.26);
          border-radius: 16px;
          background: rgba(223, 241, 201, 0.58);
          cursor: pointer;
        }

        .recording-choice input {
          width: 20px;
          height: 20px;
          accent-color: #5d9f3d;
        }

        .recording-choice span {
          display: grid;
          gap: 3px;
        }

        .recording-choice small {
          color: #60705a;
          line-height: 1.35;
        }

        .voice-selection {
          display: grid;
          gap: 10px;
          padding: 14px;
          border: 1px solid rgba(93, 159, 61, 0.2);
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.64);
        }

        .voice-selection label {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .voice-selection select {
          width: 100%;
        }

        .facebook-image-tool {
          display: grid;
          gap: 8px;
          padding: 16px;
          border: 1px solid rgba(79, 70, 229, 0.22);
          border-radius: 16px;
          background: linear-gradient(135deg, rgba(238, 242, 255, 0.9), rgba(255, 255, 255, 0.8));
        }

        .facebook-image-tool small {
          color: #4b5563;
          line-height: 1.35;
        }

        .recording-button span {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #ffffff;
          animation: recording-dot 1.2s ease-in-out infinite;
        }

        @keyframes recording-dot {
          50% {
            opacity: 0.35;
            transform: scale(0.75);
          }
        }

        .quiz-toolbar {
          grid-template-columns: repeat(5, auto);
        }

        .show-all-wrapper {
          display: flex;
          justify-content: center;
          align-items: center;
          margin-top: 24px;
        }

        .question-list {
          display: flex;
          flex-direction: column;
          gap: 0;
        }

        .question-card {
          position: relative;
          max-height: 1400px;
          margin: 0 0 20px;
          overflow: hidden;
          transition:
            max-height 0.48s cubic-bezier(0.4, 0, 0.2, 1),
            margin 0.48s cubic-bezier(0.4, 0, 0.2, 1),
            padding 0.48s cubic-bezier(0.4, 0, 0.2, 1),
            opacity 0.34s ease,
            transform 0.48s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .question-header {
          min-height: 60px;
          padding-right: 158px;
          align-items: flex-start;
        }

        .question-card.exiting {
          max-height: 0;
          margin: 0;
          padding-top: 0;
          padding-bottom: 0;
          opacity: 0;
          transform: translateY(-32px);
          pointer-events: none;
        }

        .question-card:last-child {
          margin-bottom: 0;
        }

        @media (max-width: 960px) {
          .quiz-toolbar {
            grid-template-columns: 1fr 1fr;
          }
        }

        @media (max-width: 640px) {
          .quiz-toolbar {
            grid-template-columns: 1fr;
          }
        }

        .question-card.active {
          border-color: #4f46e5;
        }

        .question-card.revealed {
          border-color: #16a34a;
        }
      `}</style>

      {/* ========================================================
          HERO
          ======================================================== */}
      <section className="hero">
        <div>
          <p className="eyebrow">Top Questions</p>

          {/* <h1>
            Pick a subject, tune the timer, and run a focused practice session.
          </h1> */}

          <p className="hero-copy">
            Lightweight by design: fast setup, clean cards, and sequential timer
            control for each question.
          </p>
        </div>

        <div className="hero-stats">
          <div className="stat">
            <span>Subjects</span>

            <strong>{subjects.length}</strong>
          </div>

          <div className="stat">
            <span>Loaded Quiz Questions</span>

            <strong>{quizState.questions.length}</strong>
          </div>
        </div>
      </section>

      {/* ========================================================
          MAIN
          ======================================================== */}
      <section className="panel layout">
        {/* ======================================================
            QUIZ SETUP
            ====================================================== */}
        <form className="config-card" onSubmit={startQuiz}>
          <h2>Quiz Setup</h2>

          {/* Subject */}
          <label>
            <span>Subject</span>

            <select
              name="subjectId"
              value={form.subjectId}
              onChange={updateField}
              required
            >
              <option value="">Select a subject</option>

              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.subName} ({subject.questionCount})
                </option>
              ))}
            </select>
          </label>

          {/* Syllabus */}
          <label>
            <span>Syllabus</span>

            <select
              name="syllabusId"
              value={form.syllabusId}
              onChange={updateField}
              required
              disabled={!syllabuses.length}
            >
              <option value="">Select a syllabus</option>

              {syllabuses.map((syllabus) => (
                <option key={syllabus.id} value={syllabus.id}>
                  {syllabus.syllabus} ({syllabus.questionCount})
                </option>
              ))}
            </select>
          </label>

          {/* Fields */}
          <div className="field-grid">
            {/* Question count */}
            <label>
              <span>How many questions</span>

              <input
                type="number"
                name="questionCount"
                min="1"
                max="100"
                value={form.questionCount}
                onChange={updateField}
                required
              />
            </label>

            {/* Questions per page */}
            <label>
              <span>Questions per page</span>

              <input
                type="number"
                name="perPage"
                min="1"
                max="20"
                value={form.perPage}
                onChange={updateField}
                required
              />
            </label>

            {/* Timer */}
            <label>
              <span>Timer per question</span>

              <input
                type="number"
                name="timerSeconds"
                min="5"
                max="300"
                value={form.timerSeconds}
                onChange={updateField}
                required
              />
            </label>
          </div>

          <label className="recording-choice">
            <input
              type="checkbox"
              name="recordVideo"
              checked={form.recordVideo}
              onChange={updateField}
            />

            <span>
              <strong>Record quiz videos</strong>
              <small>Save matching 16:9 and 9:16 videos when the quiz ends.</small>
            </span>
          </label>

          {form.recordVideo ? (
            <div className="voice-selection">
              <label>
                <input
                  type="checkbox"
                  name="narrateVideo"
                  checked={form.narrateVideo}
                  onChange={updateField}
                  disabled={!speechVoices.length || form.videoAudioMode === "music"}
                />
                <span>Read questions, options, and correct answers aloud</span>
              </label>

              <label>
                <span>Voice</span>
                <select
                  name="voiceName"
                  value={form.voiceName}
                  onChange={updateField}
                  disabled={
                    !form.narrateVideo ||
                    !speechVoices.length ||
                    form.videoAudioMode === "music"
                  }
                >
                  {!speechVoices.length ? (
                    <option value="">No local voices available</option>
                  ) : (
                    speechVoices.map((voice) => (
                      <option key={`${voice.name}-${voice.lang}`} value={voice.name}>
                        {voice.name} ({voice.lang})
                      </option>
                    ))
                  )}
                </select>
              </label>

              <button
                className="secondary-button"
                type="button"
                onClick={previewSelectedVoice}
                disabled={
                  isVoicePreviewPlaying ||
                  (form.videoAudioMode !== "music" &&
                    (!form.narrateVideo || !speechVoices.length))
                }
              >
                {isVoicePreviewPlaying ? "Playing live preview..." : "Preview live audio"}
              </button>

              <label>
                <span>Video audio</span>
                <select name="videoAudioMode" value={form.videoAudioMode} onChange={updateField}>
                  <option value="both">Voice and background music</option>
                  <option value="voice">Voice only</option>
                  <option value="music">Background music only</option>
                </select>
              </label>

              {form.videoAudioMode !== "voice" ? (
                <label>
                  <span>Music volume: {Math.round(Number(form.musicVolume) * 100)}%</span>
                  <input
                    type="range"
                    name="musicVolume"
                    min="0"
                    max="1"
                    step="0.05"
                    value={form.musicVolume}
                    onChange={updateField}
                  />
                </label>
              ) : null}

              {form.videoAudioMode !== "music" ? (
                <label>
                  <span>Voice volume: {Math.round(Number(form.voiceVolume) * 100)}%</span>
                  <input
                    type="range"
                    name="voiceVolume"
                    min="0.5"
                    max="1"
                    step="0.05"
                    value={form.voiceVolume}
                    onChange={updateField}
                  />
                </label>
              ) : null}

              <small>
                Voice audio is embedded in the saved video. When both are selected, music
                starts low so the voice stays clear.
              </small>
            </div>
          ) : null}

          <div className="facebook-image-tool">
            <strong>Facebook quiz image</strong>
            <small>Create two engaging images: a four-option question card and a correct-answer card. Descriptions are included on the answer card when available.</small>
            <label>
              <span>Image size</span>
              <select
                name="facebookImageFormat"
                value={form.facebookImageFormat}
                onChange={updateField}
              >
                {Object.entries(FACEBOOK_IMAGE_FORMATS).map(([value, format]) => (
                  <option key={value} value={value}>
                    {format.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary-button"
              type="button"
              onClick={generateFacebookQuizImage}
              disabled={isFacebookImageGenerating}
            >
              {isFacebookImageGenerating
                ? "Creating Facebook images..."
                : "Download quiz + answer images"}
            </button>
            {facebookImageError ? <small className="error-text">{facebookImageError}</small> : null}
          </div>

          {/* Start button */}
          <button
            className="primary-button"
            type="submit"
            disabled={quizState.loading}
          >
            {quizState.loading ? "Loading quiz..." : "Start quiz"}
          </button>

          {/* Error */}
          {quizState.error ? (
            <p className="error-text">{quizState.error}</p>
          ) : null}

          {/* Available questions */}
          {quizState.availableCount ? (
            <p className="muted-text">
              Available questions in this syllabus: {quizState.availableCount}
            </p>
          ) : null}
        </form>

        {/* ======================================================
            QUIZ
            ====================================================== */}
        <section className="quiz-card">
          {!session ? (
            /*
             * ==================================================
             * EMPTY STATE
             * ==================================================
             */
            <div className="empty-state">
              <h2>Ready for practice</h2>

              <p>
                Choose a subject and syllabus, then the quiz will appear here
                with timed question cards and random options.
              </p>
            </div>
          ) : (
            <>
              {/* ================================================
                  TOOLBAR
                  ================================================ */}
              <div className="quiz-toolbar">
                {/* Progress */}
                <div>
                  <p className="toolbar-label">Progress</p>

                  <strong>
                    Question {currentQuestionNumber} of{" "}
                    {session.questions.length}
                  </strong>
                </div>

                {/* Current question */}
                <div>
                  <p className="toolbar-label">Current</p>

                  <strong>
                    {currentQuestionNumber} / {session.questions.length}
                  </strong>
                </div>

                {/* Timer */}
                <div>
                  <p className="toolbar-label">Timer</p>

                  <strong>
                    {session.completed
                      ? "Done"
                      : session.pendingAdvance
                        ? "Answer shown"
                        : session.narrationStatus === "answer"
                          ? "Reading correct answer"
                        : session.narrationStatus === "waiting"
                          ? "Reading question"
                        : `${remainingSeconds}s`}
                  </strong>
                </div>

                <div>
                  <p className="toolbar-label">Video</p>

                  {recordingState === "recording" ? (
                    <button
                      className="recording-button"
                      type="button"
                      onClick={() => stopQuestionRecording()}
                    >
                      <span aria-hidden="true" /> Stop recording
                    </button>
                  ) : (
                    <strong>
                      {recordingState === "saved"
                        ? "Saved"
                        : recordingState === "unsupported"
                          ? "Unavailable"
                          : "Off"}
                    </strong>
                  )}
                </div>

                {/* Reset */}
                <button
                  className="secondary-button"
                  type="button"
                  onClick={resetQuiz}
                >
                  Reset
                </button>
              </div>

              {/* ================================================
                  QUESTION LIST
                  ================================================ */}
              <div className="question-list">
                {visibleQuestions.map((question, index) => {
                  /*
                   * Because visibleQuestions
                   * starts at activeQuestionIndex,
                   * the actual question number
                   * is:
                   *
                   * active index + index
                   */
                  const absoluteIndex = session.showAllQuestions
                    ? index
                    : session.activeQuestionIndex + index;

                  const isActive =
                    !session.showAllQuestions &&
                    absoluteIndex === session.activeQuestionIndex &&
                    !session.completed;

                  const isRevealed = session.revealedQuestionIds.includes(
                    question.id,
                  );

                  const isExiting =
                    session.advancingQuestionId === question.id;

                  const selectedAnswerId = session.selectedAnswers[question.id];

                  return (
                    <article
                      key={question.id}
                      className={`question-card ${isActive ? "active" : ""} ${
                        isRevealed ? "revealed" : ""
                      } ${isExiting ? "exiting" : ""}`}
                    >
                      {/* Question header */}
                      <div className="question-header">
                        <span>Q{absoluteIndex + 1}</span>

                        <span>
                          {isActive && !isRevealed ? (
                            /*
                             * Active question:
                             * show timer.
                             */
                            <div className="timer-wrapper">
                              <TimerClock
                                remaining={remainingSeconds}
                                total={session.timerSeconds}
                                isActive={
                                  isActive &&
                                  !session.pendingAdvance &&
                                  session.narrationStatus === "ready"
                                }
                              />
                            </div>
                          ) : isRevealed ? (
                            /*
                             * Answer has been shown.
                             */
                            <span className="answer-shown">Answer shown</span>
                          ) : (
                            /*
                             * Questions below
                             * current question.
                             */
                            "Waiting"
                          )}
                        </span>
                      </div>

                      {/* Question body */}
                      <div
                        className="question-body"
                        dangerouslySetInnerHTML={{
                          __html: question.questionHtml,
                        }}
                      />

                      {/* Options */}
                      <div className="option-list">
                        {question.options.map((option) => {
                          const isSelected = selectedAnswerId === option.id;

                          const showCorrect = isRevealed && option.isRight;

                          return (
                            <button
                              key={option.id}
                              type="button"
                              className={`option-button ${
                                isSelected ? "selected" : ""
                              } ${showCorrect ? "correct" : ""}`}
                              onClick={() =>
                                chooseAnswer(question.id, option.id)
                              }
                              disabled={
                                !isActive ||
                                isRevealed ||
                                session.showAllQuestions
                              }
                            >
                              <span
                                dangerouslySetInnerHTML={{
                                  __html: option.answerHtml,
                                }}
                              />
                            </button>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* ================================================
                  COMPLETED
                  ================================================ */}
              {session.completed && !session.showAllQuestions ? (
                <>
                  <div className="result-card">
                    <h3>Session complete</h3>

                    <p>
                      Score: {score} / {session.questions.length}
                    </p>
                  </div>

                  {/* Show all button */}
                  <div className="show-all-wrapper">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={showAllQuestions}
                    >
                      Show All Questions
                    </button>
                  </div>
                </>
              ) : null}

              {/* ================================================
                  ALL QUESTIONS
                  ================================================ */}
              {session.completed && session.showAllQuestions ? (
                <div className="result-card">
                  <h3>Quiz Review</h3>

                  <p>
                    Score: {score} / {session.questions.length}
                  </p>

                  <p>All questions and correct answers are shown above.</p>
                </div>
              ) : null}
            </>
          )}
        </section>
      </section>
    </main>
  );
}
