import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { similarityScore } from '../utils/levenshtein'
import { detectWeakSounds } from '../utils/weakSounds'
import { speechToText, speakText } from '../utils/speech'
import type { WordItem } from '../types'

interface SpeechState {
  transcript: string
  accuracy: number
  status: 'idle' | 'listening' | 'success' | 'retry' | 'teaching'
  error: string | null
  weakSounds: Array<'th' | 'rl' | 'vw' | 'silent'>
  wordIssues: Array<{
    target: string
    heard?: string
    type: 'missing' | 'extra' | 'different'
    score?: number
  }>
}

const initialState: SpeechState = {
  transcript: '',
  accuracy: 0,
  status: 'idle',
  error: null,
  weakSounds: [],
  wordIssues: [],
}

const analyzeWordDifferences = (spoken: string, target: string): SpeechState['wordIssues'] => {
  const spokenWords = spoken
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  const targetWords = target
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  const maxLen = Math.max(spokenWords.length, targetWords.length)
  const issues: SpeechState['wordIssues'] = []

  for (let i = 0; i < maxLen; i += 1) {
    const targetWord = targetWords[i]
    const spokenWord = spokenWords[i]

    if (targetWord && !spokenWord) {
      issues.push({ target: targetWord, type: 'missing' })
      continue
    }
    if (!targetWord && spokenWord) {
      issues.push({ target: '', heard: spokenWord, type: 'extra' })
      continue
    }
    if (targetWord && spokenWord) {
      const score = similarityScore(spokenWord, targetWord)
      if (score < 80) {
        issues.push({ target: targetWord, heard: spokenWord, type: 'different', score })
      }
    }
  }

  return issues
}

const explainSpeechError = (error: string) => {
  const normalized = String(error ?? '').trim().toLowerCase()

  if (!normalized) return 'Speech recognition failed. Please try again.'
  if (normalized.includes('not supported')) {
    return 'Speech recognition is not supported in this browser. Try Chrome or Edge.'
  }

  switch (normalized) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission is blocked. Allow mic access and try again.'
    case 'audio-capture':
      return 'No microphone found (or it is in use by another app).'
    case 'no-speech':
      return "I didn't hear anything. Speak a bit louder and try again."
    case 'network':
      return 'Speech service/network error. Check your internet connection and try again.'
    case 'language-not-supported':
      return 'The selected language is not supported for speech recognition.'
    case 'aborted':
      return 'Listening was stopped.'
    default:
      return `Speech recognition error: ${normalized}`
  }
}

export const useSpeechEngine = (word: WordItem, onSuccess: (accuracy: number) => void) => {
  const [state, setState] = useState<SpeechState>(initialState)
  const recognitionRef = useRef<SpeechRecognition | null>(null)

  const beginListening = useCallback(() => {
    const previousRecognition = recognitionRef.current
    if (previousRecognition) {
      previousRecognition.onresult = null
      previousRecognition.onerror = null
      previousRecognition.onend = null
      try {
        previousRecognition.abort()
      } catch {
      }
      recognitionRef.current = null
    }

    const recognition = speechToText(
      (text) => {
        const accuracy = similarityScore(text, word.text)
        const weak = detectWeakSounds(text, word.text)
        const wordIssues = analyzeWordDifferences(text, word.text)
        const passThreshold = word.difficulty === 'Beginner' ? 75 : 90
        const isPass = accuracy >= passThreshold
        setState((prev) => ({
          ...prev,
          transcript: text,
          accuracy,
          status: isPass ? 'success' : accuracy < 75 ? 'teaching' : 'retry',
          error: null,
          weakSounds: weak,
          wordIssues,
        }))
        if (isPass) {
          speakText(
            `Great job! You pronounced ${word.text} clearly with about ${Math.round(
              accuracy,
            )} percent accuracy. Let's move to the next one.`,
          )
          onSuccess(accuracy)
        } else {
          const coachingParts: string[] = []

          if (weak.includes('th')) {
            coachingParts.push(
              'Your TH sound is missing. Gently place your tongue between your teeth and push air out: th.',
            )
          }
          if (weak.includes('rl')) {
            coachingParts.push(
              'Your R or L is not clear. For R, round your lips. For L, touch the ridge just behind your top teeth.',
            )
          }
          if (weak.includes('vw')) {
            coachingParts.push(
              'Your V or W needs work. For V, bite your lower lip and add voice. For W, round your lips forward.',
            )
          }
          if (weak.includes('silent')) {
            coachingParts.push(
              'You are dropping the last consonant. Add a small clear sound at the end of the word.',
            )
          }

          const baseLine = `Let me help you say ${word.text}. Listen: ${word.syllables.join(
            ' - ',
          )}.`
          const detail = coachingParts.join(' ')

          speakText(`${baseLine} ${detail}`, 0.95)
        }
      },
      (rawError) => {
        setState((prev) => ({ ...prev, status: 'idle', error: explainSpeechError(rawError) }))
        console.error(rawError)
      },
    )

    if (recognition) {
      recognitionRef.current = recognition
      recognition.onend = () => {
        setState((prev) => {
          if (prev.status !== 'listening') return prev
          return { ...prev, status: 'idle', error: prev.error ?? "I didn't catch that. Try again." }
        })
      }

      window.speechSynthesis?.cancel()

      try {
        recognition.start()
        setState((prev) => ({ ...prev, status: 'listening', error: null }))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to start speech recognition.'
        setState((prev) => ({ ...prev, status: 'idle', error: message }))
        console.error(err)
      }
    }
  }, [word, onSuccess])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    setState((prev) => ({ ...prev, status: 'idle' }))
  }, [])

  const reset = useCallback(() => {
    setState(initialState)
  }, [])

  const tutorMessage = useMemo(() => {
    if (state.error) return state.error
    if (state.status === 'success') return 'Excellent pronunciation!'
    if (state.status === 'listening') return 'Listening... speak now.'

    if (state.status === 'teaching' || state.status === 'retry') {
      if (!state.weakSounds.length) {
        return 'Listen carefully and match the model pronunciation.'
      }

      const parts: string[] = []

      if (state.weakSounds.includes('th')) {
        parts.push('Your "th" sound is missing. Put your tongue gently between your teeth and push air.')
      }
      if (state.weakSounds.includes('rl')) {
        parts.push('Your R/L sound is unclear. Round for R, and touch the ridge behind your teeth for L.')
      }
      if (state.weakSounds.includes('vw')) {
        parts.push('Your V/W sound is weak. Bite your lower lip for V, and round your lips forward for W.')
      }
      if (state.weakSounds.includes('silent')) {
        parts.push('You are dropping the last consonant. Release a small sound at the end of the word.')
      }

      return parts.join(' ')
    }

    return 'Tap the mic to begin.'
  }, [state.error, state.status, state.weakSounds])

  useEffect(() => () => recognitionRef.current?.abort(), [])

  // When the target word changes (new item, level, or module),
  // reset transcript and accuracy so session status reflects the new word.
  useEffect(() => {
    setState(initialState)
  }, [word.text])

  return { state, beginListening, stopListening, reset, tutorMessage }
}
