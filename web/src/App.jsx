import { useEffect, useMemo, useRef, useState } from "react";

export default function App() {
  const [subjects, setSubjects] = useState([]);
  const [syllabuses, setSyllabuses] = useState([]);

  const [form, setForm] = useState({
    subjectId: "",
    syllabusId: "",
    questionCount: 10,
    perPage: 5,
    timerSeconds: 15,
    recordVideo: false,
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
  const sessionRef = useRef(null);
  const remainingSecondsRef = useRef(0);
  const recordingRef = useRef(null);
  const advanceAnimationStartedAtRef = useRef(0);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    remainingSecondsRef.current = remainingSeconds;
  }, [remainingSeconds]);

  function plainText(html) {
    const documentFragment = new DOMParser().parseFromString(html || "", "text/html");
    return documentFragment.body.textContent?.replace(/\s+/g, " ").trim() || "";
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
    const padding = isPortrait ? 40 : 56;
    const contentWidth = width - padding * 2;
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
    const videoHeading = activeSession?.videoTitle
      ? `TOP QUESTIONS (${activeSession.videoTitle})`
      : "TOP QUESTIONS";
    const headingLineHeight = isPortrait ? 22 : 24;
    const headingLines = getWrappedLines(context, videoHeading, width - padding * 2);
    headingLines.forEach((line, index) =>
      context.fillText(line, padding, padding + index * headingLineHeight),
    );

    if (!activeSession || activeSession.completed) {
      context.fillStyle = "#1f2a17";
      context.font = `800 ${isPortrait ? 52 : 64}px Manrope, sans-serif`;
      context.fillText("Session complete", padding, height / 2);
      return;
    }

    const listTop =
      padding + headingLines.length * headingLineHeight + (isPortrait ? 24 : 16);
    const cardGap = isPortrait ? 20 : 16;
    const questions = activeSession.questions.slice(
      activeSession.activeQuestionIndex,
      // Use the remaining portrait space to preview another upcoming question.
      // The canvas naturally crops the final card at the bottom of the frame.
      activeSession.activeQuestionIndex + (isPortrait ? 4 : 2),
    );
    const isAdvancing = Boolean(activeSession.advancingQuestionId);
    const animationProgress = isAdvancing
      ? Math.min(1, (performance.now() - advanceAnimationStartedAtRef.current) / 480)
      : 0;
    // Reserve room for a three-line question at the recording font size.
    const activeCardHeight = isPortrait ? 900 : 900;
    const waitingCardHeight = isPortrait ? 540 : 510;

    const drawTimerBadge = (cardTop) => {
      const badgeWidth = isPortrait ? 280 : 270;
      const badgeHeight = isPortrait ? 112 : 106;
      const badgeX = width - padding - badgeWidth - 18;
      // Center the badge on the card edge so half sits outside the card.
      const badgeY = cardTop - badgeHeight / 2;
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
      const textX = padding + cardPadding;
      const innerWidth = contentWidth - cardPadding * 2;

      context.save();
      context.globalAlpha = opacity;
      context.beginPath();
      context.roundRect(padding, top, contentWidth, cardHeight, 24);
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
          context.fillText("ANSWER SHOWN", width - padding - cardPadding, top + 40);
          context.textAlign = "left";
        } else {
          context.fillStyle = "#60705a";
          context.font = `700 ${isPortrait ? 18 : 17}px Manrope, sans-serif`;
          context.textAlign = "right";
          context.fillText("WAITING", width - padding - cardPadding, top + 40);
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
    recording.download = download;
    window.clearInterval(recording.frameInterval);
    if (recording.backgroundMusic) {
      const { audio, audioContext, destination, source } = recording.backgroundMusic;
      audio.pause();
      audio.currentTime = 0;
      source.disconnect();
      destination.stream.getTracks().forEach((track) => track.stop());
      audioContext.close();
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

    let backgroundMusic = null;
    try {
      const response = await fetch("/api/music");
      const { tracks = [] } = await response.json();
      const selectedTrack = tracks[Math.floor(Math.random() * tracks.length)];

      if (selectedTrack?.url && window.AudioContext) {
        const audio = new Audio(selectedTrack.url);
        const audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();
        const source = audioContext.createMediaElementSource(audio);
        source.connect(destination);
        audio.loop = true;
        audio.preload = "auto";
        await audioContext.resume();
        await audio.play();
        backgroundMusic = { audio, audioContext, destination, source };
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
    };

    formats.forEach((format) => {
      const canvas = document.createElement("canvas");
      canvas.width = format.width;
      canvas.height = format.height;
      const chunks = [];
      const recordingStream = canvas.captureStream(30);
      backgroundMusic?.destination.stream.getAudioTracks().forEach((track) => {
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

  /*
   * ============================================================
   * START QUIZ
   * ============================================================
   */
  function startQuiz(event) {
    event.preventDefault();

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
      .then((data) => {
        if (data.error) {
          throw new Error(data.error);
        }

        if (!data.questions?.length) {
          throw new Error("No questions found for this selection.");
        }

        setQuizState({
          loading: false,
          error: "",
          availableCount: data.availableCount,
          questions: data.questions,
        });

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

          perPage: Number(form.perPage),

          timerSeconds: Number(form.timerSeconds),

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

        sessionRef.current = newSession;
        remainingSecondsRef.current = Number(form.timerSeconds);
        setSession(newSession);

        setRemainingSeconds(Number(form.timerSeconds));
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
    setSession((current) => {
      if (!current) {
        return current;
      }

      const question = current.questions[current.activeQuestionIndex];

      if (!question) {
        return current;
      }

      /*
       * Already revealed.
       */
      if (current.revealedQuestionIds.includes(question.id)) {
        return current;
      }

      return {
        ...current,

        revealedQuestionIds: [...current.revealedQuestionIds, question.id],

        /*
         * Start 2 second delay.
         */
        pendingAdvance: true,
      };
    });
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

          <h1>
            Pick a subject, tune the timer, and run a focused practice session.
          </h1>

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
                                isActive={isActive && !session.pendingAdvance}
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
