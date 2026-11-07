import React, { useState, useEffect, useMemo } from 'react';
import {
  Trophy,
  Users,
  Settings,
  Play,
  CheckCircle2,
  Clock,
  Plus,
  Trash2,
  Edit3,
  Download,
  Upload,
  Maximize2,
  Minimize2,
  Printer,
  ChevronRight,
  X,
  Sparkles,
  Crown,
  Layers,
  Flag,
  Shield,
  Check,
  AlertTriangle,
  Undo2,
  Megaphone,
  Building2,
  ArrowLeftRight,
  LayoutGrid,
  FileSpreadsheet,
  Eye,
  QrCode,
  Copy,
  UserX,
  Shuffle,
  SlidersHorizontal,
  ZoomIn,
  ZoomOut,
  Wifi,
  CloudCheck,
  FolderPlus,
  FolderOpen
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

const STORAGE_KEY = "iaido_tournament_app_v9";

// --- Firebase Cloud Sync Setup ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const app = firebaseConfig ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// 団体戦ポジション（5名定数）
const TEAM_POSITIONS = ['先鋒', '次鋒', '中堅', '副将', '大将'];

// --- Standard Bracket Seed Placement Helper ---
function getSeedOrder(n) {
  if (n <= 2) return [1, 2];
  const prev = getSeedOrder(n / 2);
  const result = [];
  for (let i = 0; i < prev.length; i++) {
    result.push(prev[i]);
    result.push(n + 1 - prev[i]);
  }
  return result;
}

// --- Standard Seed Placement & Same Dojo Avoidance Pairing Logic ---
function optimizeSlotsAvoidSameDojo(entrantsList, bracketSize, avoidSameDojo = false) {
  const pool = [...entrantsList];
  const slots = new Array(bracketSize).fill(null);

  // 1. シード選手と一般選手を分離（シード番号順にソート）
  const seeded = pool
    .filter(e => e.seed > 0)
    .sort((a, b) => (a.seed || 999) - (b.seed || 999));

  // 2. ブラケットサイズごとの標準シード配置位置を取得
  const seedOrder = getSeedOrder(bracketSize);
  const seedToSlot = {};
  seedOrder.forEach((seedNum, slotIdx) => {
    seedToSlot[seedNum] = slotIdx;
  });

  // 不戦枠（BYE）の総数を計算
  const numEntrants = pool.length;
  const numByes = bracketSize - numEntrants;

  // 不戦枠（BYE）は第1シード、第2シード...の対戦相手枠に優先確保
  const reservedByeSlots = new Set();
  for (let s = 1; s <= numByes; s++) {
    const mainSlot = seedToSlot[s];
    if (mainSlot !== undefined) {
      // 1回戦の対戦相手スロット（偶数なら+1, 奇数なら-1）
      const opponentSlot = mainSlot % 2 === 0 ? mainSlot + 1 : mainSlot - 1;
      reservedByeSlots.add(opponentSlot);
    }
  }

  // 3. シード選手を対応するシード枠へ配置
  const placedSet = new Set();
  seeded.forEach((player, idx) => {
    const seedRank = idx + 1;
    if (seedRank <= bracketSize) {
      const slotIdx = seedToSlot[seedRank];
      slots[slotIdx] = player;
      placedSet.add(player.id);
    }
  });

  // 未配置の選手リスト
  const remainingPlayers = pool.filter(p => !placedSet.has(p.id));

  // 4. 不戦枠（BYE）ではない空枠に未配置の選手を割り当て
  for (let s = 1; s <= bracketSize; s++) {
    const mainSlot = seedToSlot[s];
    if (mainSlot !== undefined && !slots[mainSlot] && !reservedByeSlots.has(mainSlot)) {
      const oppSlot = mainSlot % 2 === 0 ? mainSlot + 1 : mainSlot - 1;
      if (reservedByeSlots.has(oppSlot) && remainingPlayers.length > 0) {
        slots[mainSlot] = remainingPlayers.shift();
      }
    }
  }

  // 残りの非BYE空枠を順に埋める
  for (let i = 0; i < bracketSize; i++) {
    if (!slots[i] && !reservedByeSlots.has(i) && remainingPlayers.length > 0) {
      slots[i] = remainingPlayers.shift();
    }
  }

  // 予備: まだ未配置の選手がいれば空き枠に入れる
  for (let i = 0; i < bracketSize; i++) {
    if (!slots[i] && remainingPlayers.length > 0) {
      slots[i] = remainingPlayers.shift();
    }
  }

  // 5. 同一所属回避（オプション有効時、1回戦で同じ道場・所属同士が当たらないよう微調整）
  if (avoidSameDojo) {
    for (let pairIdx = 0; pairIdx < bracketSize / 2; pairIdx++) {
      const idxA = pairIdx * 2;
      const idxB = pairIdx * 2 + 1;
      const pA = slots[idxA];
      const pB = slots[idxB];

      if (pA && pB && pA.dojo && pB.dojo && pA.dojo === pB.dojo && pA.dojo !== '') {
        const isASeeded = pA.seed > 0;
        const isBSeeded = pB.seed > 0;
        const targetSlotToSwap = isBSeeded && !isASeeded ? idxA : idxB;
        const targetPlayer = slots[targetSlotToSwap];

        for (let otherPair = pairIdx + 1; otherPair < bracketSize / 2; otherPair++) {
          const oIdxA = otherPair * 2;
          const oIdxB = otherPair * 2 + 1;
          const oPA = slots[oIdxA];
          const oPB = slots[oIdxB];

          if (oPA && oPB) {
            if (oPB && oPB.seed <= 0 && targetPlayer.dojo !== oPA.dojo && (slots[targetSlotToSwap === idxA ? idxB : idxA]?.dojo !== oPB.dojo)) {
              slots[targetSlotToSwap] = oPB;
              slots[oIdxB] = targetPlayer;
              break;
            } else if (oPA && oPA.seed <= 0 && targetPlayer.dojo !== oPB.dojo && (slots[targetSlotToSwap === idxA ? idxB : idxA]?.dojo !== oPA.dojo)) {
              slots[targetSlotToSwap] = oPA;
              slots[oIdxA] = targetPlayer;
              break;
            }
          }
        }
      }
    }
  }

  return slots;
}

export default function App() {
  // Check viewer mode and tournament ID from query params or hash (#t=ID&mode=view|admin)
  const getUrlParams = () => {
    if (typeof window === 'undefined') return { tourneyId: null, isView: false, isLocked: false };
    const params = new URLSearchParams(window.location.search);
    let tourneyId = params.get('t') || params.get('tourney');
    let mode = params.get('mode');
    let isView = params.get('view') === '1' || mode === 'view';

    // Hash形式 (#t=...&mode=...) の解析フォールバック（サーバーでの404回避用）
    if (window.location.hash) {
      const hashString = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
      const hashParams = new URLSearchParams(hashString);
      if (!tourneyId) tourneyId = hashParams.get('t') || hashParams.get('tourney');
      if (!mode) mode = hashParams.get('mode');
      if (hashParams.get('view') === '1' || mode === 'view') isView = true;
    }

    return {
      tourneyId,
      isView,
      isLocked: mode === 'view' || isView
    };
  };

  const initialUrlParams = getUrlParams();

  // Authentication & Online Sync State
  const [user, setUser] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Master State with Multi-Tournament Support
  const [appData, setAppData] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const defaultTourney = {
      id: "tourney-1",
      title: "第50回 全国居合道演武大会",
      activeDivisionId: "div-1",
      bracketViewStyle: "standard",
      isPublicViewerEnabled: true,
      divisions: [
        { id: "div-1", name: "個人の部", type: "individual", entrants: [], matches: [], status: "setup", thirdPlaceOption: "both_third", avoidSameDojoInR1: false }
      ]
    };

    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.divisions && !parsed.tournaments) {
          const migratedTourney = {
            id: "tourney-1",
            title: parsed.title || "第50回 全国居合道演武大会",
            activeDivisionId: parsed.activeDivisionId || "div-1",
            bracketViewStyle: parsed.bracketViewStyle || "standard",
            isPublicViewerEnabled: parsed.isPublicViewerEnabled ?? true,
            divisions: parsed.divisions.map(d => ({
              type: 'individual',
              avoidSameDojoInR1: false,
              ...d
            }))
          };
          return {
            activeTournamentId: "tourney-1",
            tournaments: [migratedTourney]
          };
        }
        if (parsed.tournaments && Array.isArray(parsed.tournaments) && parsed.tournaments.length > 0) {
          return parsed;
        }
      } catch (e) {
        console.error("Failed to load state", e);
      }
    }
    return {
      activeTournamentId: "tourney-1",
      tournaments: [defaultTourney]
    };
  });

  // URLパラメータ・ハッシュからの対象大会への自動切り替え
  useEffect(() => {
    const handleUrlSync = () => {
      const params = getUrlParams();
      if (params.tourneyId) {
        updateAppData(prev => {
          const exists = (prev.tournaments || []).some(t => t.id === params.tourneyId);
          if (exists && prev.activeTournamentId !== params.tourneyId) {
            return { ...prev, activeTournamentId: params.tourneyId };
          }
          return prev;
        });
      }
    };

    handleUrlSync();
    window.addEventListener('hashchange', handleUrlSync);
    window.addEventListener('popstate', handleUrlSync);
    return () => {
      window.removeEventListener('hashchange', handleUrlSync);
      window.removeEventListener('popstate', handleUrlSync);
    };
  }, []);

  // 2. Real-time Firestore Sync Listener (Snapshot across devices)
  useEffect(() => {
    if (!db || !user) return;
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'tournament_data', 'main');

    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const remoteData = docSnap.data()?.appData;
        if (remoteData) {
          setAppData(prev => {
            if (JSON.stringify(prev) !== JSON.stringify(remoteData)) {
              return remoteData;
            }
            return prev;
          });
        }
      }
    }, (error) => {
      console.error("Firestore sync error:", error);
    });

    return () => unsubscribe();
  }, [user]);

  // Unified State Updater with Automatic Cloud Sync
  const updateAppData = (updater) => {
    setAppData(prev => {
      const nextData = typeof updater === 'function' ? updater(prev) : updater;
      
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextData));
      } catch (e) {
        console.error("Failed to save local state", e);
      }

      if (db && user) {
        setIsSyncing(true);
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'tournament_data', 'main');
        setDoc(docRef, {
          appData: nextData,
          updatedAt: new Date().toISOString(),
          updatedBy: user.uid
        }, { merge: true })
          .catch(err => console.error("Cloud sync failed:", err))
          .finally(() => setIsSyncing(false));
      }

      return nextData;
    });
  };

  const updateActiveTournament = (updater) => {
    updateAppData(prev => {
      const tournaments = (prev.tournaments || []).map(t => {
        if (t.id === prev.activeTournamentId) {
          return typeof updater === 'function' ? updater(t) : { ...t, ...updater };
        }
        return t;
      });
      return { ...prev, tournaments };
    });
  };

  // UI Local State
  const [isViewerMode, setIsViewerMode] = useState(initialUrlParams.isView);
  const [isViewLocked] = useState(initialUrlParams.isLocked);
  const [activeTab, setActiveTab] = useState("bracket");
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [toast, setToast] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);

  // Tournament Management Modal State
  const [showTournamentManager, setShowTournamentManager] = useState(false);
  const [newTournamentTitleInput, setNewTournamentTitleInput] = useState("");

  // Manual Bracket Construction Modal State
  const [showManualBuildModal, setShowManualBuildModal] = useState(false);
  const [manualBracketSize, setManualBracketSize] = useState(8);
  const [manualSlots, setManualSlots] = useState([]);

  // Entrant Inputs
  const [newPlayer, setNewPlayer] = useState({ name: "", dojo: "", isSeed: false, isAbsent: false });
  const [editingEntrant, setEditingEntrant] = useState(null);

  // Slot Edit Direct Modal
  const [slotEditMatch, setSlotEditMatch] = useState(null);

  // Division Edit / Add Modal State
  const [divisionModal, setDivisionModal] = useState(null);

  // Judgement State
  const [redFlagCount, setRedFlagCount] = useState(3);
  const [whiteFlagCount, setWhiteFlagCount] = useState(0);
  const [matchNote, setMatchNote] = useState("");

  // 団体戦用 5対5各ポジション判定 State
  const [teamGames, setTeamGames] = useState(() => 
    TEAM_POSITIONS.map(pos => ({ position: pos, redFlags: 3, whiteFlags: 0, winner: 'red', redPlayer: '', whitePlayer: '' }))
  );
  const [activeTeamPosIdx, setActiveTeamPosIdx] = useState(0);

  // Batch Import / Sample Generation State
  const [batchText, setBatchText] = useState("");
  const [parsedBatch, setParsedBatch] = useState([]);
  const [sampleCount, setSampleCount] = useState(8);

  // Active Tournament & Active Division Getters
  const activeTournament = useMemo(() => {
    const list = appData.tournaments || [];
    return list.find(t => t.id === appData.activeTournamentId) || list[0] || {
      id: "tourney-default",
      title: "無題の大会",
      activeDivisionId: "div-1",
      bracketViewStyle: "standard",
      isPublicViewerEnabled: true,
      divisions: []
    };
  }, [appData.tournaments, appData.activeTournamentId]);

  const activeDivision = useMemo(() => {
    const divs = activeTournament.divisions || [];
    const found = divs.find(d => d.id === activeTournament.activeDivisionId) || divs[0] || {
      id: "div-1",
      name: "個人の部",
      type: 'individual',
      entrants: [],
      matches: [],
      status: 'setup',
      thirdPlaceOption: 'both_third',
      avoidSameDojoInR1: false
    };
    return { type: 'individual', avoidSameDojoInR1: false, ...found };
  }, [activeTournament]);

  const isTeamDivision = activeDivision.type === 'team';

  const getPlayer = (id) => {
    if (!id) return null;
    return activeDivision.entrants.find(e => e.id === id) || null;
  };

  const maxRound = useMemo(() => {
    if (!activeDivision || !activeDivision.matches || activeDivision.matches.length === 0) return 1;
    return Math.max(...activeDivision.matches.map(m => m.round));
  }, [activeDivision]);

  // Toast Helper
  const showToast = (msg, type = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // JSON Import/Export
  const handleExportJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${activeTournament.title || "tournament"}_backup.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast("JSONバックアップをダウンロードしました", "success");
  };

  const handleImportJSON = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (imported) {
          updateAppData(imported);
          showToast("JSONデータを読み込みました", "success");
        }
      } catch (err) {
        showToast("JSONファイルの読み込みに失敗しました", "error");
      }
    };
    reader.readAsText(file);
  };

  // Tournament operations
  const handleCreateNewTournament = (titleName) => {
    const title = titleName.trim() || `新しい大会 (${new Date().toLocaleDateString('ja-JP')})`;
    const newId = `tourney-${Date.now()}`;
    const newTourney = {
      id: newId,
      title: title,
      activeDivisionId: `div-${Date.now()}-1`,
      bracketViewStyle: "standard",
      isPublicViewerEnabled: true,
      divisions: [
        { id: `div-${Date.now()}-1`, name: "個人の部", type: "individual", entrants: [], matches: [], status: "setup", thirdPlaceOption: "both_third", avoidSameDojoInR1: false }
      ]
    };

    updateAppData(prev => ({
      ...prev,
      activeTournamentId: newId,
      tournaments: [...(prev.tournaments || []), newTourney]
    }));
    setNewTournamentTitleInput("");
    setShowTournamentManager(false);
    showToast(`大会「${title}」を新規作成しました`, "success");
  };

  const handleSwitchTournament = (id) => {
    updateAppData(prev => ({
      ...prev,
      activeTournamentId: id
    }));
    setShowTournamentManager(false);
    const target = appData.tournaments.find(t => t.id === id);
    showToast(`大会「${target ? target.title : ''}」へ切り替えました`, "info");
  };

  const handleDuplicateTournament = (tourney) => {
    const newId = `tourney-${Date.now()}`;
    const dupTourney = {
      ...tourney,
      id: newId,
      title: `${tourney.title} (コピー)`,
      divisions: tourney.divisions.map(d => ({
        ...d,
        id: `div-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        matches: [],
        status: "setup"
      }))
    };

    updateAppData(prev => ({
      ...prev,
      activeTournamentId: newId,
      tournaments: [...(prev.tournaments || []), dupTourney]
    }));
    setShowTournamentManager(false);
    showToast(`大会「${dupTourney.title}」を作成しました`, "success");
  };

  const handleDeleteTournament = (id) => {
    if ((appData.tournaments || []).length <= 1) {
      showToast("大会データは最低1つ必要です", "error");
      return;
    }
    const target = appData.tournaments.find(t => t.id === id);
    if (!window.confirm(`大会「${target ? target.title : ''}」を完全に削除しますか？`)) return;

    updateAppData(prev => {
      const remaining = prev.tournaments.filter(t => t.id !== id);
      return {
        ...prev,
        activeTournamentId: prev.activeTournamentId === id ? remaining[0].id : prev.activeTournamentId,
        tournaments: remaining
      };
    });
    showToast("大会データを削除しました");
  };

  const handleTogglePublicViewer = () => {
    const nextState = !activeTournament.isPublicViewerEnabled;
    updateActiveTournament(t => ({
      ...t,
      isPublicViewerEnabled: nextState
    }));
    showToast(nextState ? "観客向け公開を『ON (公開中)』に設定しました" : "観客向け公開を『OFF (停止中)』に設定しました", nextState ? "success" : "info");
  };

  // URLパラメータからの対象大会への自動切り替え
  useEffect(() => {
    if (initialUrlParams.tourneyId) {
      updateAppData(prev => {
        const exists = (prev.tournaments || []).some(t => t.id === initialUrlParams.tourneyId);
        if (exists && prev.activeTournamentId !== initialUrlParams.tourneyId) {
          return { ...prev, activeTournamentId: initialUrlParams.tourneyId };
        }
        return prev;
      });
    }
  }, []);

  const handleGenerateSampleEntrants = (count) => {
    const num = Math.max(2, parseInt(count) || 2);
    const prefix = isTeamDivision ? "チーム" : "選手";
    const generated = Array.from({ length: num }, (_, i) => ({
      id: `p-sample-${Date.now()}-${i + 1}`,
      name: `${prefix} ${i + 1}`,
      dojo: "",
      seed: 0,
      isAbsent: false
    }));

    updateActiveTournament(t => ({
      ...t,
      divisions: t.divisions.map(d => d.id === t.activeDivisionId ? {
        ...d,
        entrants: [...d.entrants, ...generated]
      } : d)
    }));
    showToast(`${num} 件のサンプルデータを生成しました`, "success");
  };

  // 一括登録テキスト解析 Effect
  useEffect(() => {
    if (!batchText.trim()) {
      setParsedBatch([]);
      return;
    }
    const lines = batchText.split("\n");
    const parsed = [];
    lines.forEach(line => {
      const parts = line.split(/,|\t/).map(s => s.trim()).filter(Boolean);
      if (parts.length >= 1 && parts[0]) {
        parsed.push({
          name: parts[0],
          dojo: parts[1] || "",
          seed: parseInt(parts[2]) || 0
        });
      }
    });
    setParsedBatch(parsed);
  }, [batchText]);

  const buildBracketFromSlots = (slotsArray, bracketSize) => {
    const matches = [];
    let matchIdCounter = 1;
    const numRounds = Math.log2(bracketSize);
    let previousRoundMatches = [];

    // Round 1
    for (let i = 0; i < bracketSize / 2; i++) {
      const redPlayerId = slotsArray[i * 2] || null;
      const whitePlayerId = slotsArray[i * 2 + 1] || null;

      const pRed = getPlayer(redPlayerId);
      const pWhite = getPlayer(whitePlayerId);

      const match = {
        id: `M${matchIdCounter++}`,
        round: 1,
        playerRedId: redPlayerId,
        playerWhiteId: whitePlayerId,
        winnerId: null,
        redFlags: 0,
        whiteFlags: 0,
        subMatches: isTeamDivision ? TEAM_POSITIONS.map(pos => ({ position: pos, redFlags: 0, whiteFlags: 0, winner: null, redPlayer: '', whitePlayer: '' })) : null,
        status: 'pending',
        note: '',
        nextMatchId: null,
        nextMatchSlot: null,
        loserNextMatchId: null,
        loserNextMatchSlot: null,
        isThirdPlace: false
      };

      if (pRed && !pWhite) {
        match.winnerId = pRed.id;
        match.status = 'completed';
        match.note = 'シード';
      } else if (!pRed && pWhite) {
        match.winnerId = pWhite.id;
        match.status = 'completed';
        match.note = 'シード';
      }

      matches.push(match);
      previousRoundMatches.push(match);
    }

    // Round 2 to Final
    for (let r = 2; r <= numRounds; r++) {
      const currentRoundMatches = [];
      const count = previousRoundMatches.length / 2;

      for (let i = 0; i < count; i++) {
        const parentMatchA = previousRoundMatches[i * 2];
        const parentMatchB = previousRoundMatches[i * 2 + 1];

        const match = {
          id: `M${matchIdCounter++}`,
          round: r,
          playerRedId: parentMatchA.winnerId || null,
          playerWhiteId: parentMatchB.winnerId || null,
          winnerId: null,
          redFlags: 0,
          whiteFlags: 0,
          subMatches: isTeamDivision ? TEAM_POSITIONS.map(pos => ({ position: pos, redFlags: 0, whiteFlags: 0, winner: null, redPlayer: '', whitePlayer: '' })) : null,
          status: 'pending',
          note: '',
          nextMatchId: null,
          nextMatchSlot: null,
          loserNextMatchId: null,
          loserNextMatchSlot: null,
          isThirdPlace: false
        };

        parentMatchA.nextMatchId = match.id;
        parentMatchA.nextMatchSlot = 'red';
        parentMatchB.nextMatchId = match.id;
        parentMatchB.nextMatchSlot = 'white';

        currentRoundMatches.push(match);
        matches.push(match);
      }
      previousRoundMatches = currentRoundMatches;
    }

    if (activeDivision.thirdPlaceOption === 'third_place_match' && numRounds >= 2) {
      const semiFinals = matches.filter(m => m.round === numRounds - 1 && !m.isThirdPlace);
      if (semiFinals.length === 2) {
        const thirdMatch = {
          id: `M3rd`,
          round: numRounds,
          playerRedId: null,
          playerWhiteId: null,
          winnerId: null,
          redFlags: 0,
          whiteFlags: 0,
          subMatches: isTeamDivision ? TEAM_POSITIONS.map(pos => ({ position: pos, redFlags: 0, whiteFlags: 0, winner: null, redPlayer: '', whitePlayer: '' })) : null,
          status: 'pending',
          note: '',
          nextMatchId: null,
          nextMatchSlot: null,
          loserNextMatchId: null,
          loserNextMatchSlot: null,
          isThirdPlace: true
        };
        semiFinals[0].loserNextMatchId = thirdMatch.id;
        semiFinals[0].loserNextMatchSlot = 'red';
        semiFinals[1].loserNextMatchId = thirdMatch.id;
        semiFinals[1].loserNextMatchSlot = 'white';

        matches.push(thirdMatch);
      }
    }

    updateActiveTournament(t => ({
      ...t,
      divisions: t.divisions.map(d => d.id === t.activeDivisionId ? {
        ...d,
        status: 'in_progress',
        matches: matches
      } : d)
    }));
  };

  const handleAutoBuildBracket = () => {
    const entrants = activeDivision.entrants.filter(e => !e.isAbsent);
    if (entrants.length < 2) {
      showToast("トーナメントを作成するには2名（または2チーム）以上の登録が必要です", "error");
      return;
    }

    let size = 2;
    while (size < entrants.length) {
      size *= 2;
    }

    const slots = optimizeSlotsAvoidSameDojo(entrants, size, activeDivision.avoidSameDojoInR1);
    const slotIds = slots.map(s => s ? s.id : null);

    buildBracketFromSlots(slotIds, size);
    showToast("トーナメント自動組みを作成しました", "success");
  };

  const handleOpenManualBuildModal = () => {
    const entrants = activeDivision.entrants;
    let size = 2;
    while (size < entrants.length) {
      size *= 2;
    }
    setManualBracketSize(size);
    const slots = new Array(size).fill(null);
    entrants.forEach((e, idx) => {
      if (idx < size) slots[idx] = e.id;
    });
    setManualSlots(slots);
    setShowManualBuildModal(true);
  };

  const handleManualSizeChange = (newSize) => {
    setManualBracketSize(newSize);
    setManualSlots(prev => {
      const copy = new Array(newSize).fill(null);
      for (let i = 0; i < Math.min(prev.length, newSize); i++) {
        copy[i] = prev[i];
      }
      return copy;
    });
  };

  const handleSaveManualBuild = () => {
    buildBracketFromSlots(manualSlots, manualBracketSize);
    setShowManualBuildModal(false);
    showToast("手動組みトーナメントを生成しました", "success");
  };

  const openMatchJudgement = (match) => {
    setSelectedMatch(match);
    setMatchNote(match.note || "");
    if (isTeamDivision) {
      if (match.subMatches && match.subMatches.length === 5) {
        setTeamGames(match.subMatches.map(m => ({ ...m })));
      } else {
        setTeamGames(TEAM_POSITIONS.map(pos => ({
          position: pos,
          redFlags: 3,
          whiteFlags: 0,
          winner: 'red',
          redPlayer: '',
          whitePlayer: ''
        })));
      }
      setActiveTeamPosIdx(0);
    } else {
      setRedFlagCount(match.redFlags || 3);
      setWhiteFlagCount(match.whiteFlags || 0);
    }
  };

  const handleSaveMatchJudgement = (winnerOverride = null, noteOverride = null) => {
    if (!selectedMatch) return;

    let winnerId = null;
    let redFlags = redFlagCount;
    let whiteFlags = whiteFlagCount;
    let note = noteOverride !== null ? noteOverride : matchNote;
    let subMatchesToSave = null;

    if (winnerOverride) {
      winnerId = winnerOverride;
    } else if (isTeamDivision) {
      subMatchesToSave = [...teamGames];
      let redWins = 0;
      let whiteWins = 0;
      teamGames.forEach(g => {
        if (g.winner === 'red') redWins++;
        if (g.winner === 'white') whiteWins++;
      });

      if (redWins > whiteWins) {
        winnerId = selectedMatch.playerRedId;
      } else if (whiteWins > redWins) {
        winnerId = selectedMatch.playerWhiteId;
      } else {
        let totalRedFlags = 0;
        let totalWhiteFlags = 0;
        teamGames.forEach(g => {
          totalRedFlags += g.redFlags;
          totalWhiteFlags += g.whiteFlags;
        });
        winnerId = totalRedFlags >= totalWhiteFlags ? selectedMatch.playerRedId : selectedMatch.playerWhiteId;
      }
      redFlags = redWins;
      whiteFlags = whiteWins;
    } else {
      if (redFlagCount > whiteFlagCount) {
        winnerId = selectedMatch.playerRedId;
      } else if (whiteFlagCount > redFlagCount) {
        winnerId = selectedMatch.playerWhiteId;
      }
    }

    updateActiveTournament(t => ({
      ...t,
      divisions: t.divisions.map(d => {
        if (d.id !== t.activeDivisionId) return d;
        let matches = d.matches.map(m => {
          if (m.id === selectedMatch.id) {
            return {
              ...m,
              winnerId: winnerId === 'DOUBLE_ABSENT' ? null : winnerId,
              redFlags,
              whiteFlags,
              subMatches: subMatchesToSave || m.subMatches,
              status: 'completed',
              note: note
            };
          }
          return m;
        });

        const currentM = matches.find(m => m.id === selectedMatch.id);
        if (currentM) {
          if (currentM.nextMatchId) {
            matches = matches.map(m => {
              if (m.id === currentM.nextMatchId) {
                const nextM = { ...m };
                const advPlayerId = (winnerId === 'DOUBLE_ABSENT') ? null : winnerId;
                if (currentM.nextMatchSlot === 'red') nextM.playerRedId = advPlayerId;
                if (currentM.nextMatchSlot === 'white') nextM.playerWhiteId = advPlayerId;
                return nextM;
              }
              return m;
            });
          }

          if (currentM.loserNextMatchId && d.thirdPlaceOption === 'third_place_match') {
            const loserId = (currentM.playerRedId === winnerId) ? currentM.playerWhiteId : currentM.playerRedId;
            matches = matches.map(m => {
              if (m.id === currentM.loserNextMatchId) {
                const loserM = { ...m };
                if (currentM.loserNextMatchSlot === 'red') loserM.playerRedId = loserId;
                if (currentM.loserNextMatchSlot === 'white') loserM.playerWhiteId = loserId;
                return loserM;
              }
              return m;
            });
          }
        }

        return { ...d, matches };
      })
    }));

    setSelectedMatch(null);
    setMatchNote("");
    showToast("試合結果を保存しました", "success");
  };

  const handleRollbackMatch = (matchId) => {
    if (!window.confirm("この試合の結果を取り消しますか？以後の進出結果も巻き戻されます。")) return;

    updateActiveTournament(t => ({
      ...t,
      divisions: t.divisions.map(d => {
        if (d.id !== t.activeDivisionId) return d;

        let matches = d.matches.map(m => ({ ...m }));
        const rollbackQueue = [matchId];
        const resetMatchIds = new Set();

        while (rollbackQueue.length > 0) {
          const currentId = rollbackQueue.shift();
          resetMatchIds.add(currentId);

          const targetMatch = matches.find(m => m.id === currentId);
          if (targetMatch && targetMatch.nextMatchId) {
            rollbackQueue.push(targetMatch.nextMatchId);
          }
          if (targetMatch && targetMatch.loserNextMatchId) {
            rollbackQueue.push(targetMatch.loserNextMatchId);
          }
        }

        matches = matches.map(m => {
          if (resetMatchIds.has(m.id)) {
            const isTarget = m.id === matchId;
            const updated = { ...m };
            updated.winnerId = null;
            updated.status = 'pending';
            if (isTarget) {
              updated.note = '';
              updated.redFlags = 0;
              updated.whiteFlags = 0;
            } else {
              const parentsRed = d.matches.find(pm => pm.nextMatchId === m.id && pm.nextMatchSlot === 'red');
              const parentsWhite = d.matches.find(pm => pm.nextMatchId === m.id && pm.nextMatchSlot === 'white');

              if (parentsRed && resetMatchIds.has(parentsRed.id)) updated.playerRedId = null;
              if (parentsWhite && resetMatchIds.has(parentsWhite.id)) updated.playerWhiteId = null;
            }
            return updated;
          }
          return m;
        });

        return { ...d, matches };
      })
    }));

    showToast("試合結果を取り消し、状態を巻き戻しました");
  };

  const handleSwapRound1Slot = (matchId, targetSlot, newPlayerId) => {
    updateActiveTournament(t => ({
      ...t,
      divisions: t.divisions.map(d => {
        if (d.id !== t.activeDivisionId) return d;
        const matches = d.matches.map(m => {
          if (m.id !== matchId) return m;
          const updated = { ...m };
          if (targetSlot === 'red') updated.playerRedId = newPlayerId || null;
          if (targetSlot === 'white') updated.playerWhiteId = newPlayerId || null;

          const pRed = updated.playerRedId ? d.entrants.find(e => e.id === updated.playerRedId) : null;
          const pWhite = updated.playerWhiteId ? d.entrants.find(e => e.id === updated.playerWhiteId) : null;

          if (pRed && !pWhite) {
            updated.winnerId = pRed.id;
            updated.status = 'completed';
            updated.note = 'シード';
          } else if (!pRed && pWhite) {
            updated.winnerId = pWhite.id;
            updated.status = 'completed';
            updated.note = 'シード';
          } else {
            if (updated.note === 'シード') {
              updated.winnerId = null;
              updated.status = 'pending';
              updated.note = '';
            }
          }
          return updated;
        });

        const currentMatch = matches.find(m => m.id === matchId);
        if (currentMatch && currentMatch.nextMatchId) {
          const nextM = matches.find(nm => nm.id === currentMatch.nextMatchId);
          if (nextM) {
            if (currentMatch.nextMatchSlot === 'red') nextM.playerRedId = currentMatch.winnerId || null;
            if (currentMatch.nextMatchSlot === 'white') nextM.playerWhiteId = currentMatch.winnerId || null;
          }
        }

        return { ...d, matches };
      })
    }));
  };

  const handleAddPlayer = () => {
    if (!newPlayer.name.trim()) {
      showToast(isTeamDivision ? "チーム名を入力してください" : "選手氏名を入力してください", "error");
      return;
    }

    updateActiveTournament(t => ({
      ...t,
      divisions: t.divisions.map(d => {
        if (d.id !== t.activeDivisionId) return d;
        const currentMaxSeed = Math.max(0, ...d.entrants.map(e => e.seed || 0));
        const newE = {
          id: `p-${Date.now()}`,
          name: newPlayer.name.trim(),
          dojo: newPlayer.dojo.trim(),
          seed: newPlayer.isSeed ? (currentMaxSeed + 1) : 0,
          isAbsent: false
        };
        return {
          ...d,
          entrants: [...d.entrants, newE]
        };
      })
    }));

    setNewPlayer({ name: "", dojo: "", isSeed: false, isAbsent: false });
    showToast(isTeamDivision ? "チームを追加しました" : "選手を追加しました");
  };

  const handleApplyBatchImport = () => {
    if (parsedBatch.length === 0) return;

    updateActiveTournament(t => ({
      ...t,
      divisions: t.divisions.map(d => {
        if (d.id !== t.activeDivisionId) return d;
        const added = parsedBatch.map((item, idx) => ({
          id: `p-${Date.now()}-${idx}`,
          name: item.name,
          dojo: item.dojo,
          seed: item.seed,
          isAbsent: false
        }));
        return {
          ...d,
          entrants: [...d.entrants, ...added]
        };
      })
    }));

    setBatchText("");
    setParsedBatch([]);
    showToast(`${parsedBatch.length} 件を一括登録しました`, "success");
  };

  const handleDeletePlayer = (id) => {
    updateActiveTournament(t => ({
      ...t,
      divisions: t.divisions.map(d => d.id === t.activeDivisionId ? {
        ...d,
        entrants: d.entrants.filter(e => e.id !== id)
      } : d)
    }));
    showToast(isTeamDivision ? "チームを削除しました" : "選手を削除しました");
  };

  const handleToggleAbsent = (id) => {
    updateActiveTournament(t => ({
      ...t,
      divisions: t.divisions.map(d => d.id === t.activeDivisionId ? {
        ...d,
        entrants: d.entrants.map(e => e.id === id ? { ...e, isAbsent: !e.isAbsent } : e)
      } : d)
    }));
  };

  const handleAddDivision = (name, type = 'individual') => {
    if (!name || !name.trim()) return;
    const newId = `div-${Date.now()}`;
    updateActiveTournament(t => ({
      ...t,
      activeDivisionId: newId,
      divisions: [
        ...t.divisions,
        {
          id: newId,
          name: name.trim(),
          type: type,
          entrants: [],
          matches: [],
          status: "setup",
          thirdPlaceOption: "both_third",
          avoidSameDojoInR1: false
        }
      ]
    }));
    showToast(`部門「${name.trim()}」（${type === 'team' ? '団体戦' : '個人戦'}）を追加しました`, "success");
  };

  const handleRenameDivision = (id, newName, newType) => {
    if (!newName || !newName.trim()) return;
    updateActiveTournament(t => ({
      ...t,
      divisions: t.divisions.map(d => d.id === id ? { ...d, name: newName.trim(), type: newType || d.type || 'individual' } : d)
    }));
    showToast("部門設定を保存しました", "success");
  };

  const handleDeleteDivision = (id) => {
    if (activeTournament.divisions.length <= 1) {
      showToast("部門は最低1つ必要です", "error");
      return;
    }
    if (!window.confirm("この部門を削除しますか？登録選手やトーナメントデータも削除されます。")) return;
    updateActiveTournament(t => {
      const nextDivs = t.divisions.filter(d => d.id !== id);
      return {
        ...t,
        activeDivisionId: t.activeDivisionId === id ? nextDivs[0].id : t.activeDivisionId,
        divisions: nextDivs
      };
    });
    showToast("部門を削除しました");
  };

  const handleUpdateDivisionSettings = (key, value) => {
    updateActiveTournament(t => ({
      ...t,
      divisions: t.divisions.map(d => d.id === t.activeDivisionId ? { ...d, [key]: value } : d)
    }));
    showToast("部門設定を更新しました");
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  };

  const getRoundTitle = (roundNum, totalRounds) => {
    if (roundNum === totalRounds) return "決勝戦";
    if (roundNum === totalRounds - 1) return "準決勝";
    if (roundNum === totalRounds - 2) return "準々決勝";
    return `${roundNum}回戦`;
  };

  const getTournamentURL = (mode = 'view') => {
    if (typeof window === 'undefined') return '';
    try {
      let href = window.location.href;
      // blobやdataプロトコルの場合はbase originフォールバック
      if (href.startsWith('blob:') || href.startsWith('data:')) {
        href = window.location.origin + window.location.pathname;
      }
      const url = new URL(href);
      url.search = '';
      url.hash = `t=${encodeURIComponent(activeTournament.id)}&mode=${mode}`;
      return url.toString();
    } catch (e) {
      return `#t=${encodeURIComponent(activeTournament.id)}&mode=${mode}`;
    }
  };

  const copyToClipboard = async (text) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      console.warn("Clipboard API restricted, using execCommand fallback", err);
    }

    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "-9999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);
      return successful;
    } catch (fallbackErr) {
      console.error("Fallback copy failed", fallbackErr);
      return false;
    }
  };

  // --- MATCH CARD RENDER HELPER FUNCTION ---
  const renderMatchCard = (match, isHighlightFinal = false, isRightWing = false) => {
    if (!match) return null;
    const pRed = getPlayer(match.playerRedId);
    const pWhite = getPlayer(match.playerWhiteId);
    const isCompleted = match.status === 'completed';
    const redWins = match.winnerId && match.winnerId === match.playerRedId;
    const whiteWins = match.winnerId && match.winnerId === match.playerWhiteId;
    const isRound1 = match.round === 1;
    const hasNextMatch = !!match.nextMatchId && !match.isThirdPlace;
    const hasWinner = !!match.winnerId;

    const isSeedMatch = isRound1 && (match.note === 'シード' || (!pRed && pWhite) || (pRed && !pWhite));

    let teamRedWinsCount = 0;
    let teamWhiteWinsCount = 0;
    if (isTeamDivision && match.subMatches) {
      match.subMatches.forEach(g => {
        if (g.winner === 'red') teamRedWinsCount++;
        if (g.winner === 'white') teamWhiteWinsCount++;
      });
    }

    const roundTitle = match.isThirdPlace ? '3位決定戦' : getRoundTitle(match.round, maxRound);

    return (
      <div key={match.id} className="relative group w-full">
        {/* 右方向へのトーナメント接続線 (標準表示 & 左右対称の左山) */}
        {!isRightWing && hasNextMatch && (
          <div className="absolute top-0 bottom-0 -right-8 w-8 pointer-events-none z-10 flex items-center">
            <svg className="w-8 h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 32 100">
              <path
                d={match.nextMatchSlot === 'red'
                  ? "M 0,50 L 16,50 L 16,100 L 32,100"
                  : "M 0,50 L 16,50 L 16,0 L 32,0"}
                fill="none"
                stroke={hasWinner ? "#dc2626" : "#cbd5e1"}
                strokeWidth={hasWinner ? "3.5" : "2"}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={hasWinner ? { filter: 'drop-shadow(0px 0px 3px rgba(220,38,38,0.5))' } : {}}
              />
            </svg>
          </div>
        )}

        {/* 左方向へのトーナメント接続線 (左右対称の右山) */}
        {isRightWing && hasNextMatch && (
          <div className="absolute top-0 bottom-0 -left-8 w-8 pointer-events-none z-10 flex items-center">
            <svg className="w-8 h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 32 100">
              <path
                d={match.nextMatchSlot === 'red'
                  ? "M 32,50 L 16,50 L 16,100 L 0,100"
                  : "M 32,50 L 16,50 L 16,0 L 0,0"}
                fill="none"
                stroke={hasWinner ? "#dc2626" : "#cbd5e1"}
                strokeWidth={hasWinner ? "3.5" : "2"}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={hasWinner ? { filter: 'drop-shadow(0px 0px 3px rgba(220,38,38,0.5))' } : {}}
              />
            </svg>
          </div>
        )}

        {/* 対戦カード本体 */}
        <div
          className={`bg-white rounded-2xl border transition shadow-sm hover:shadow-md ${
            isHighlightFinal
              ? 'border-red-500 ring-2 ring-red-500/20'
              : isSeedMatch
              ? 'border-amber-300 bg-amber-50/20 ring-1 ring-amber-300/40'
              : 'border-slate-200'
          }`}
        >
          {/* Match Header */}
          <div className={`px-3 py-1.5 rounded-t-2xl border-b flex items-center justify-between ${
            isSeedMatch ? 'bg-amber-100/70 border-amber-200' : 'bg-slate-50 border-slate-200'
          }`}>
            <div className="flex items-center space-x-1.5">
              <span className={`text-[11px] font-bold ${isSeedMatch ? 'text-amber-900' : 'text-red-600'}`}>
                {roundTitle}
              </span>
              {isSeedMatch && (
                <span className="px-1.5 py-0.2 rounded bg-amber-200/90 text-amber-900 font-extrabold text-[9px] border border-amber-300">
                  ★ シード枠
                </span>
              )}
            </div>
            {match.note && match.note.trim() !== '' && match.note !== 'シード' && (
              <span className="text-[10px] font-bold text-slate-600 bg-slate-200 px-2 py-0.5 rounded truncate max-w-[180px]">
                備考: {match.note}
              </span>
            )}
          </div>

          {/* Contestants Box */}
          <div className="p-3 space-y-2">
            {/* Red Side */}
            <div className={`p-2.5 rounded-xl border flex items-center justify-between transition relative ${
              !pRed && isRound1
                ? 'bg-slate-50 border-dashed border-slate-300 opacity-60'
                : redWins
                ? isSeedMatch
                  ? 'bg-amber-50 border-amber-400 font-bold border-r-4 border-r-amber-500'
                  : 'bg-red-50 border-red-500 font-bold border-r-4 border-r-red-600'
                : 'bg-white border-slate-200'
            }`}>
              <div className="flex items-center space-x-2.5 min-w-0 flex-1">
                <span className={`px-2 py-0.5 rounded font-bold text-[10px] shrink-0 ${
                  !pRed && isRound1 ? 'bg-slate-300 text-slate-600' : 'bg-red-600 text-white'
                }`}>
                  赤
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-bold tracking-tight truncate ${!pRed && isRound1 ? 'text-slate-400 italic' : 'text-slate-900'}`}>
                    {pRed ? pRed.name : (isRound1 ? '（不戦勝・シード枠）' : '未確定')}
                  </div>
                  {pRed && pRed.dojo && (
                    <div className="text-[10px] text-slate-500 truncate">{pRed.dojo}</div>
                  )}
                </div>
              </div>

              {/* Individual Score flags */}
              {!isTeamDivision && isCompleted && (
                <div className="flex items-center space-x-1 shrink-0 font-bold text-xs">
                  {isSeedMatch && redWins ? (
                    <span className="text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded text-[10px] font-extrabold border border-amber-300">
                      2回戦進出
                    </span>
                  ) : match.note && match.note.includes('赤欠場') ? (
                    <span className="text-red-600 text-[11px]">赤欠場</span>
                  ) : match.note && match.note.includes('白欠場') ? (
                    <span className="text-emerald-700 text-[11px]">不戦勝</span>
                  ) : (
                    <span className={redWins ? 'text-red-600 font-mono text-sm font-black' : 'text-slate-400 font-mono'}>
                      {match.redFlags}
                    </span>
                  )}
                </div>
              )}

              {/* Team Score */}
              {isTeamDivision && isCompleted && (
                <div className="text-xs font-bold font-mono text-red-600 shrink-0">
                  {isSeedMatch && redWins ? (
                    <span className="text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded text-[10px] font-extrabold border border-amber-300">
                      2回戦進出
                    </span>
                  ) : (
                    `${teamRedWinsCount}勝`
                  )}
                </div>
              )}
            </div>

            {/* 団体戦 先鋒〜大将 5試合の大型詳細結果ボックス */}
            {isTeamDivision && (
              <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 space-y-1.5">
                {TEAM_POSITIONS.map((pos, idx) => {
                  const sub = match.subMatches && match.subMatches[idx] ? match.subMatches[idx] : null;
                  const subRedWin = sub && sub.winner === 'red';
                  const subWhiteWin = sub && sub.winner === 'white';

                  let scoreLabel = '-';
                  if (sub) {
                    if (sub.note === 'red_absent') scoreLabel = '赤欠場';
                    else if (sub.note === 'white_absent') scoreLabel = '白欠場';
                    else if (sub.note === 'double_absent') scoreLabel = '両欠場';
                    else if (isCompleted || sub.redFlags > 0 || sub.whiteFlags > 0) {
                      scoreLabel = `${sub.redFlags}-${sub.whiteFlags}`;
                    }
                  }

                  return (
                    <div key={pos} className="flex items-center justify-between text-[11px] bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                      <span className="font-bold text-slate-500 shrink-0 w-10">{pos}</span>
                      
                      <div className="flex-1 flex items-center justify-between px-2 text-[10px] truncate">
                        <span className={`truncate ${subRedWin ? 'font-bold text-red-700' : 'text-slate-600'}`}>
                          {sub?.redPlayer || (pRed ? '配置済' : '-')}
                        </span>
                        <span className="text-slate-300 px-1">vs</span>
                        <span className={`truncate ${subWhiteWin ? 'font-bold text-slate-900' : 'text-slate-600'}`}>
                          {sub?.whitePlayer || (pWhite ? '配置済' : '-')}
                        </span>
                      </div>

                      <span className={`font-mono text-[10px] font-bold shrink-0 ${
                        subRedWin ? 'text-red-600' : subWhiteWin ? 'text-slate-900 font-extrabold' : 'text-slate-400'
                      }`}>
                        {scoreLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* White Side */}
            <div className={`p-2.5 rounded-xl border flex items-center justify-between transition relative ${
              !pWhite && isRound1
                ? 'bg-slate-50 border-dashed border-slate-300 opacity-60'
                : whiteWins
                ? isSeedMatch
                  ? 'bg-amber-50 border-amber-400 font-bold border-r-4 border-r-amber-500'
                  : 'bg-slate-100 border-slate-700 font-bold border-r-4 border-r-red-600'
                : 'bg-white border-slate-200'
            }`}>
              <div className="flex items-center space-x-2.5 min-w-0 flex-1">
                <span className={`px-2 py-0.5 rounded font-bold text-[10px] shrink-0 ${
                  !pWhite && isRound1 ? 'bg-slate-300 text-slate-600' : 'bg-slate-900 text-white'
                }`}>
                  白
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-bold tracking-tight truncate ${!pWhite && isRound1 ? 'text-slate-400 italic' : 'text-slate-900'}`}>
                    {pWhite ? pWhite.name : (isRound1 ? '（不戦勝・シード枠）' : '未確定')}
                  </div>
                  {pWhite && pWhite.dojo && (
                    <div className="text-[10px] text-slate-500 truncate">{pWhite.dojo}</div>
                  )}
                </div>
              </div>

              {/* Individual Score flags */}
              {!isTeamDivision && isCompleted && (
                <div className="flex items-center space-x-1 shrink-0 font-bold text-xs">
                  {isSeedMatch && whiteWins ? (
                    <span className="text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded text-[10px] font-extrabold border border-amber-300">
                      2回戦進出
                    </span>
                  ) : match.note && match.note.includes('白欠場') ? (
                    <span className="text-red-600 text-[11px]">白欠場</span>
                  ) : match.note && match.note.includes('赤欠場') ? (
                    <span className="text-emerald-700 text-[11px]">不戦勝</span>
                  ) : (
                    <span className={whiteWins ? 'text-slate-900 font-mono text-sm font-black' : 'text-slate-400 font-mono'}>
                      {match.whiteFlags}
                    </span>
                  )}
                </div>
              )}

              {/* Team Score */}
              {isTeamDivision && isCompleted && (
                <div className="text-xs font-bold font-mono text-slate-900 shrink-0">
                  {isSeedMatch && whiteWins ? (
                    <span className="text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded text-[10px] font-extrabold border border-amber-300">
                      2回戦進出
                    </span>
                  ) : (
                    `${teamWhiteWinsCount}勝`
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Card Footer Actions */}
          {!isViewerMode && (
            <div className="no-print bg-slate-50 px-3 py-2 rounded-b-2xl border-t border-slate-200 flex items-center justify-between">
              <button
                onClick={() => openMatchJudgement(match)}
                disabled={!pRed && !pWhite}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                  isCompleted
                    ? 'bg-slate-200 text-slate-800 hover:bg-slate-300'
                    : 'bg-red-600 text-white hover:bg-red-700 shadow-sm'
                }`}
              >
                {isCompleted ? '結果修正' : '判定入力'}
              </button>

              <div className="flex items-center space-x-1">
                {isCompleted && (
                  <button
                    onClick={() => handleRollbackMatch(match.id)}
                    className="p-1 text-slate-400 hover:text-red-600 text-[10px] font-bold"
                    title="結果取り消し"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                  </button>
                )}
                {isRound1 && !isCompleted && (
                  <button
                    onClick={() => setSlotEditMatch(match)}
                    className="p-1 text-slate-400 hover:text-slate-700 text-[10px] font-bold"
                    title="枠変更"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-red-600 selection:text-white">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 animate-bounce">
          <div className={`px-4 py-3 rounded-2xl shadow-xl border text-xs font-bold flex items-center gap-2 ${
            toast.type === 'error' ? 'bg-red-600 border-red-700 text-white' :
            toast.type === 'success' ? 'bg-emerald-600 border-emerald-700 text-white' :
            'bg-white border-slate-300 text-slate-800 shadow-md'
          }`}>
            <Sparkles className="w-4 h-4 text-amber-500" />
            <span>{toast.msg}</span>
          </div>
        </div>
      )}

      {/* Header Bar */}
      <header className="no-print border-b border-red-100 bg-white/95 backdrop-blur-md sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-4">
          
          {/* Title & Division Selector */}
          <div className="flex items-center space-x-3">
            <div>
              <div className="flex items-center space-x-2 flex-wrap gap-2">
                <input
                  type="text"
                  disabled={isViewerMode}
                  value={activeTournament.title}
                  onChange={(e) => updateActiveTournament(t => ({ ...t, title: e.target.value }))}
                  className="bg-transparent text-lg sm:text-xl font-black text-slate-900 focus:outline-none focus:border-red-600 rounded px-1 border-b border-transparent hover:border-slate-300 transition max-w-xs sm:max-w-md"
                  placeholder="大会名を入力"
                />

                {!isViewerMode && (
                  <button
                    onClick={() => setShowTournamentManager(true)}
                    className="px-2.5 py-1 text-xs font-bold bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl transition flex items-center gap-1.5 shadow-sm"
                    title="大会の一覧・新規作成・切り替え"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-red-600" />
                    <span>大会切替・新規 ({(appData.tournaments || []).length})</span>
                  </button>
                )}
              </div>

              {/* Division Selector Tabs */}
              <div className="flex items-center space-x-2 mt-1 flex-wrap gap-y-1">
                <span className="text-xs text-slate-500 font-bold">部門:</span>
                {(activeTournament.divisions || []).map(div => (
                  <div key={div.id} className="flex items-center space-x-1">
                    <button
                      onClick={() => updateActiveTournament(t => ({ ...t, activeDivisionId: div.id }))}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                        activeTournament.activeDivisionId === div.id
                          ? 'bg-red-600 text-white shadow-md'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                      }`}
                    >
                      <span>{div.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                        activeTournament.activeDivisionId === div.id ? 'bg-red-700 text-red-100' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {div.type === 'team' ? '団体' : '個人'}
                      </span>
                      <span className="text-[10px] opacity-80">({div.entrants.length})</span>
                    </button>

                    {activeTournament.activeDivisionId === div.id && !isViewerMode && (
                      <button
                        onClick={() => setDivisionModal({ id: div.id, name: div.name, type: div.type || 'individual' })}
                        className="p-1 text-slate-400 hover:text-red-600 transition"
                        title="部門設定を変更"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}

                {!isViewerMode && (
                  <button
                    onClick={() => setDivisionModal({ id: null, name: "", type: "individual" })}
                    className="px-2.5 py-1 rounded-lg bg-white hover:bg-red-50 text-red-600 text-xs border border-red-200 transition flex items-center gap-1 font-bold shadow-sm"
                    title="新しい部門を追加"
                  >
                    <Plus className="w-3.5 h-3.5 text-red-600" />
                    <span>部門追加</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Header Controls */}
          <div className="flex items-center space-x-2 flex-wrap gap-y-2">
            <div className="px-3 py-1.5 text-xs font-bold rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-sm flex items-center gap-1.5">
              <Wifi className={`w-3.5 h-3.5 text-emerald-600 ${isSyncing ? 'animate-spin text-amber-600' : 'animate-pulse'}`} />
              <span>{isSyncing ? 'クラウド同期中...' : 'リアルタイム同時編集 ON'}</span>
            </div>

            {!isViewerMode && (
              <button
                onClick={handleTogglePublicViewer}
                className={`px-3 py-1.5 text-xs font-bold rounded-xl border flex items-center gap-1.5 transition shadow-sm ${
                  activeTournament.isPublicViewerEnabled
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                    : 'bg-red-50 border-red-300 text-red-700 hover:bg-red-100'
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${activeTournament.isPublicViewerEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                <span>観客公開: {activeTournament.isPublicViewerEnabled ? 'ON (公開中)' : 'OFF (停止中)'}</span>
              </button>
            )}

            {!isViewLocked && (
              <button
                onClick={() => setIsViewerMode(!isViewerMode)}
                className={`px-3 py-1.5 text-xs font-bold rounded-xl border flex items-center gap-1.5 transition shadow-sm ${
                  isViewerMode
                    ? 'bg-amber-500 border-amber-600 text-white'
                    : 'bg-slate-800 border-slate-900 text-white'
                }`}
              >
                {isViewerMode ? <Eye className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
                <span>{isViewerMode ? '観客閲覧モード' : '本部管理モード'}</span>
              </button>
            )}

            <button
              onClick={() => setShowQRModal(true)}
              className="px-3 py-1.5 text-xs font-bold rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 transition shadow-sm flex items-center gap-1.5"
            >
              <QrCode className="w-3.5 h-3.5 text-red-600" />
              閲覧用URL
            </button>

            {!isViewerMode && (
              <>
                <label className="px-2.5 py-1.5 text-xs font-bold rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 transition shadow-sm flex items-center gap-1 cursor-pointer">
                  <Upload className="w-3.5 h-3.5 text-slate-500" />
                  JSON
                  <input type="file" accept=".json" onChange={handleImportJSON} className="hidden" />
                </label>

                <button
                  onClick={handleExportJSON}
                  className="px-2.5 py-1.5 text-xs font-bold rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 transition shadow-sm flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  保存
                </button>
              </>
            )}

            <button
              onClick={() => window.print()}
              className="px-2.5 py-1.5 text-xs font-bold rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 transition shadow-sm flex items-center gap-1"
            >
              <Printer className="w-3.5 h-3.5 text-slate-500" />
              印刷
            </button>

            <button
              onClick={toggleFullscreen}
              className="p-1.5 text-xs font-bold rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 transition shadow-sm"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Main Navigation Tabs */}
      <div className="no-print bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 flex items-center space-x-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('bracket')}
            className={`py-3 px-4 text-xs font-extrabold border-b-2 transition flex items-center gap-2 whitespace-nowrap ${
              activeTab === 'bracket' ? 'border-red-600 text-red-600' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Trophy className="w-4 h-4 text-red-600" />
            トーナメント表
          </button>

          {!isViewerMode && (
            <button
              onClick={() => setActiveTab('entrants')}
              className={`py-3 px-4 text-xs font-extrabold border-b-2 transition flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'entrants' ? 'border-red-600 text-red-600' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Users className="w-4 h-4 text-slate-600" />
              {isTeamDivision ? 'チーム登録・対戦組み合わせ構築' : '選手登録・対戦組み合わせ構築'}
            </button>
          )}
        </div>
      </div>

      {/* Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {/* 観客閲覧非公開（OFF）時の案内メッセージ画面 */}
        {isViewerMode && !activeTournament.isPublicViewerEnabled ? (
          <div className="text-center py-20 bg-white border border-slate-200 rounded-3xl p-8 space-y-4 shadow-sm max-w-xl mx-auto my-8">
            <UserX className="w-16 h-16 text-red-400 mx-auto" />
            <h3 className="text-xl font-black text-slate-900">現在は非公開です</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              大会本部により、観客向けのリアルタイムトーナメント閲覧が停止されています。<br />
              公開が開始されるまで、しばらくお待ちください。
            </p>
          </div>
        ) : activeTab === 'bracket' ? (
          /* TOURNAMENT BRACKET TAB */
          <div className="space-y-6">
            {/* Controls Bar for Bracket */}
            <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center space-x-4 flex-wrap gap-y-2">
                {/* View Style Switcher */}
                <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
                  <button
                    onClick={() => updateActiveTournament(t => ({ ...t, bracketViewStyle: 'symmetric' }))}
                    className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                      activeTournament.bracketViewStyle === 'symmetric'
                        ? 'bg-red-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    左右対称
                  </button>
                  <button
                    onClick={() => updateActiveTournament(t => ({ ...t, bracketViewStyle: 'standard' }))}
                    className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                      activeTournament.bracketViewStyle === 'standard'
                        ? 'bg-red-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    片側 (標準)
                  </button>
                </div>

                {/* Zoom Controller */}
                <div className="flex items-center space-x-2 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
                  <ZoomIn className="w-4 h-4 text-red-600" />
                  <span className="text-xs font-bold text-slate-700">表示倍率:</span>
                  <button
                    onClick={() => setZoomLevel(prev => Math.max(25, prev - 10))}
                    className="w-6 h-6 rounded bg-white hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center justify-center border border-slate-300 transition shadow-sm"
                    title="縮小"
                  >
                    -
                  </button>
                  <input
                    type="range"
                    min="25"
                    max="150"
                    step="5"
                    value={zoomLevel}
                    onChange={(e) => setZoomLevel(Number(e.target.value))}
                    className="w-24 accent-red-600 cursor-pointer"
                  />
                  <button
                    onClick={() => setZoomLevel(prev => Math.min(150, prev + 10))}
                    className="w-6 h-6 rounded bg-white hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center justify-center border border-slate-300 transition shadow-sm"
                    title="拡大"
                  >
                    +
                  </button>
                  <span className="text-xs font-mono font-bold text-red-700 w-10 text-right">{zoomLevel}%</span>
                  <button
                    onClick={() => setZoomLevel(100)}
                    className="px-2 py-0.5 rounded bg-white hover:bg-slate-200 text-[10px] text-slate-600 font-bold border border-slate-300 ml-1 transition shadow-sm"
                  >
                    100%
                  </button>
                </div>
              </div>

              {!isViewerMode && (
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleAutoBuildBracket()}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5" />
                    自動組み作成
                  </button>

                  <button
                    onClick={handleOpenManualBuildModal}
                    className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-800 font-bold text-xs rounded-xl border border-slate-300 transition flex items-center gap-1.5 shadow-sm"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5 text-slate-600" />
                    手動構築モード
                  </button>
                </div>
              )}
            </div>

            {/* Bracket Rendering Container */}
            {activeDivision.matches.length === 0 ? (
              <div className="text-center py-16 bg-white border border-slate-200 rounded-3xl p-8 space-y-4 shadow-sm">
                <Trophy className="w-16 h-16 text-slate-300 mx-auto animate-pulse" />
                <h3 className="text-lg font-bold text-slate-800">トーナメント表が未作成です</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  「選手登録・対戦組み合わせ構築」タブで選手を登録したあと、自動組み作成または手動構築を行ってください。
                </p>
                {!isViewerMode && (
                  <button
                    onClick={() => setActiveTab('entrants')}
                    className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-md transition"
                  >
                    選手登録画面へ
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-auto pb-8 pt-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div
                  style={{
                    transform: `scale(${zoomLevel / 100})`,
                    transformOrigin: 'top left',
                    width: zoomLevel < 100 ? `${(100 / zoomLevel) * 100}%` : 'max-content'
                  }}
                  className="transition-transform duration-150 ease-out"
                >
                  {/* STANDARD / PYRAMID VIEW */}
                  {activeTournament.bracketViewStyle === 'standard' ? (
                    <div className="flex items-stretch gap-12 min-w-max p-4 min-h-[500px]">
                      {Array.from({ length: maxRound }, (_, i) => i + 1).map((roundNum) => {
                        const roundMatches = activeDivision.matches.filter(
                          m => m.round === roundNum && !m.isThirdPlace
                        );
                        return (
                          <div key={roundNum} className="flex flex-col justify-around items-center w-64 space-y-6">
                            <div className="text-center font-bold text-xs bg-slate-100 text-slate-700 px-3 py-1 rounded-full border border-slate-200 w-full mb-2">
                              {getRoundTitle(roundNum, maxRound)}
                            </div>
                            <div className="flex-1 flex flex-col justify-around w-full space-y-4">
                              {roundMatches.map(m => renderMatchCard(m, roundNum === maxRound, false))}
                            </div>
                            {roundNum === maxRound && activeDivision.thirdPlaceOption === 'third_place_match' && (
                              <div className="w-full mt-8 pt-4 border-t border-slate-200">
                                {activeDivision.matches.filter(m => m.isThirdPlace).map(m => renderMatchCard(m, false, false))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* SYMMETRIC BRACKET DISPLAY */
                    <div className="flex justify-between items-stretch gap-8 min-w-max p-4 min-h-[500px]">
                      {/* Left Wing */}
                      {Array.from({ length: maxRound - 1 }, (_, i) => i + 1).map((roundNum) => {
                        const roundMatches = activeDivision.matches.filter(
                          m => m.round === roundNum && !m.isThirdPlace
                        );
                        const halfCount = Math.ceil(roundMatches.length / 2);
                        const leftMatches = roundMatches.slice(0, halfCount);
                        return (
                          <div key={`left-${roundNum}`} className="flex flex-col justify-around items-center w-64">
                            <div className="text-center font-bold text-xs bg-slate-100 text-slate-700 px-3 py-1 rounded-full border border-slate-200 w-full mb-2">
                              {getRoundTitle(roundNum, maxRound)} (左)
                            </div>
                            <div className="flex-1 flex flex-col justify-around w-full space-y-4">
                              {leftMatches.map(m => renderMatchCard(m, false, false))}
                            </div>
                          </div>
                        );
                      })}

                      {/* Center Column: Final */}
                      <div className="flex flex-col justify-around items-center w-72 px-4 border-x border-slate-200">
                        <div className="text-center font-bold text-xs bg-red-600 text-white px-4 py-1.5 rounded-full shadow-md w-full mb-2 flex items-center justify-center gap-1">
                          <Crown className="w-3.5 h-3.5 text-amber-300" />
                          決勝戦
                        </div>
                        <div className="w-full">
                          {activeDivision.matches
                            .filter(m => m.round === maxRound && !m.isThirdPlace)
                            .map(m => renderMatchCard(m, true, false))}
                        </div>

                        {activeDivision.thirdPlaceOption === 'third_place_match' && (
                          <div className="w-full mt-6 pt-4 border-t border-slate-200">
                            <div className="text-center font-bold text-xs bg-slate-100 text-slate-700 px-3 py-1 rounded-full border border-slate-200 w-full mb-2">
                              3位決定戦
                            </div>
                            {activeDivision.matches.filter(m => m.isThirdPlace).map(m => renderMatchCard(m, false, false))}
                          </div>
                        )}
                      </div>

                      {/* Right Wing */}
                      {Array.from({ length: maxRound - 1 }, (_, i) => maxRound - 1 - i).map((roundNum) => {
                        const roundMatches = activeDivision.matches.filter(
                          m => m.round === roundNum && !m.isThirdPlace
                        );
                        const halfCount = Math.ceil(roundMatches.length / 2);
                        const rightMatches = roundMatches.slice(halfCount);
                        return (
                          <div key={`right-${roundNum}`} className="flex flex-col justify-around items-center w-64">
                            <div className="text-center font-bold text-xs bg-slate-100 text-slate-700 px-3 py-1 rounded-full border border-slate-200 w-full mb-2">
                              {getRoundTitle(roundNum, maxRound)} (右)
                            </div>
                            <div className="flex-1 flex flex-col justify-around w-full space-y-4">
                              {rightMatches.map(m => renderMatchCard(m, false, true))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ENTRANTS & SETUP TAB */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column: Form & Batch Import */}
            <div className="space-y-6 lg:col-span-1">
              {/* Add Entrant Card */}
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <UserX className="w-4 h-4 text-red-600" />
                  {isTeamDivision ? '新規チームの追加' : '新規選手の追加'}
                </h3>

                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-bold text-slate-600">{isTeamDivision ? 'チーム名 *' : '氏名 *'}</label>
                    <input
                      type="text"
                      placeholder={isTeamDivision ? "例: ○○道場 Aチーム" : "例: 山田 太郎"}
                      value={newPlayer.name}
                      onChange={(e) => setNewPlayer({ ...newPlayer, name: e.target.value })}
                      className="w-full mt-1 bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 font-bold focus:outline-none focus:border-red-600"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-600">所属 (道場・支部)</label>
                    <input
                      type="text"
                      placeholder="例: 東京支部"
                      value={newPlayer.dojo}
                      onChange={(e) => setNewPlayer({ ...newPlayer, dojo: e.target.value })}
                      className="w-full mt-1 bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 font-bold focus:outline-none focus:border-red-600"
                    />
                  </div>

                  <div>
                    <label className="flex items-center space-x-2 bg-slate-50 border border-slate-300 rounded-xl p-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={newPlayer.isSeed}
                        onChange={(e) => setNewPlayer({ ...newPlayer, isSeed: e.target.checked })}
                        className="w-4 h-4 accent-red-600 rounded cursor-pointer"
                      />
                      <span className="text-xs font-bold text-red-700">シード権を付与する</span>
                    </label>
                  </div>

                  <button
                    onClick={handleAddPlayer}
                    className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    追加登録
                  </button>
                </div>
              </div>

              {/* Batch CSV/TSV Import Card */}
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-slate-700" />
                  一括貼り付け（CSV・カンマ区切り）
                </h3>

                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Excelやテキストからコピーして貼り付けられます。<br />
                  形式: 氏名, 所属道場, シード番号(任意)
                </p>

                <textarea
                  rows={4}
                  placeholder="山田 太郎, 東京道場, 1&#10;佐藤 次郎, 大阪支部, 0&#10;鈴木 花子, 京都道場"
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs font-mono text-slate-900 focus:outline-none focus:border-red-600"
                />

                {parsedBatch.length > 0 && (
                  <div className="text-xs font-bold text-emerald-700 bg-emerald-50 p-2.5 rounded-xl border border-emerald-200">
                    検出件数: {parsedBatch.length} 件
                  </div>
                )}

                <button
                  onClick={handleApplyBatchImport}
                  disabled={parsedBatch.length === 0}
                  className={`w-full py-2.5 font-bold text-xs rounded-xl shadow-sm transition ${
                    parsedBatch.length > 0
                      ? 'bg-slate-900 hover:bg-black text-white'
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  一括登録を実行 ({parsedBatch.length}件)
                </button>
              </div>

              {/* Sample Generation Options */}
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-3">
                <h3 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  サンプルデータの自動生成
                </h3>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="2"
                    max="64"
                    value={sampleCount}
                    onChange={(e) => setSampleCount(e.target.value)}
                    className="w-20 bg-slate-50 border border-slate-300 rounded-xl p-2 text-xs font-bold text-center"
                  />
                  <button
                    onClick={() => handleGenerateSampleEntrants(sampleCount)}
                    className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl border border-slate-300 transition"
                  >
                    サンプル生成
                  </button>
                </div>
              </div>
            </div>

            {/* Right Column: Registered List */}
            <div className="space-y-6 lg:col-span-2">
              <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex justify-between items-center border-b border-slate-200 pb-3 flex-wrap gap-2">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      登録済み一覧 ({activeDivision.entrants.length} 名/チーム)
                    </h3>
                    <p className="text-xs text-slate-500">
                      ドラッグやチェックボックスで順序やシード・不戦勝属性を設定できます。
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handleAutoBuildBracket}
                      disabled={activeDivision.entrants.length < 2}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-md transition flex items-center gap-1.5 disabled:bg-slate-300"
                    >
                      <Play className="w-3.5 h-3.5" />
                      トーナメントを再自動作成
                    </button>
                  </div>
                </div>

                {/* Division Settings Toggles */}
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">3位決定戦の設定</label>
                    <select
                      value={activeDivision.thirdPlaceOption || 'both_third'}
                      onChange={(e) => handleUpdateDivisionSettings('third_place_option', e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-xl p-2 text-xs text-slate-900 font-bold"
                    >
                      <option value="both_third">両者を3位（3位決定戦なし）</option>
                      <option value="third_place_match">3位決定戦を行う</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">1回戦の同門回避機能</label>
                    <label className="flex items-center space-x-2 bg-white border border-slate-300 rounded-xl p-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={activeDivision.avoidSameDojoInR1 || false}
                        onChange={(e) => handleUpdateDivisionSettings('avoidSameDojoInR1', e.target.checked)}
                        className="w-4 h-4 accent-red-600 rounded cursor-pointer"
                      />
                      <span className="text-xs font-bold text-slate-800">同一所属の対戦を回避する</span>
                    </label>
                  </div>
                </div>

                {/* Entrant Cards List */}
                {activeDivision.entrants.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 text-xs font-bold border-2 border-dashed border-slate-200 rounded-2xl">
                    選手またはチームがまだ登録されていません
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                    {activeDivision.entrants.map((player, idx) => (
                      <div
                        key={player.id}
                        className={`p-3 rounded-2xl border transition flex items-center justify-between gap-3 ${
                          player.isAbsent
                            ? 'bg-slate-100 border-slate-300 opacity-50'
                            : player.seed > 0
                            ? 'bg-amber-50/80 border-amber-300'
                            : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="flex items-center space-x-3 min-w-0 flex-1">
                          <span className="w-6 text-center font-mono text-xs font-bold text-slate-400">
                            {idx + 1}
                          </span>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center space-x-2">
                              <span className="text-sm font-bold text-slate-900 truncate">
                                {player.name}
                              </span>
                              {player.seed > 0 && (
                                <span className="px-2 py-0.5 rounded bg-amber-200 text-amber-900 text-[10px] font-black border border-amber-300 shrink-0">
                                  シード #{player.seed}
                                </span>
                              )}
                              {player.isAbsent && (
                                <span className="px-2 py-0.5 rounded bg-slate-300 text-slate-700 text-[10px] font-bold shrink-0">
                                  欠場
                                </span>
                              )}
                            </div>
                            {player.dojo && (
                              <div className="text-[11px] text-slate-500 truncate">{player.dojo}</div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center space-x-1 shrink-0">
                          <button
                            onClick={() => handleToggleAbsent(player.id)}
                            className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition ${
                              player.isAbsent
                                ? 'bg-slate-800 text-white border-slate-900'
                                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                            }`}
                          >
                            {player.isAbsent ? '欠場中' : '欠場'}
                          </button>

                          <button
                            onClick={() => setEditingEntrant(player)}
                            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => handleDeletePlayer(player.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* --- TOURNAMENT MANAGER MODAL --- */}
      {showTournamentManager && !isViewerMode && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-red-600" />
                大会データ管理・新規作成
              </h3>
              <button onClick={() => setShowTournamentManager(false)} className="text-slate-400 hover:text-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
              <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <FolderPlus className="w-4 h-4 text-red-600" />
                新しい大会を作成する
              </h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="例: 第51回 秋季居合道大会"
                  value={newTournamentTitleInput}
                  onChange={(e) => setNewTournamentTitleInput(e.target.value)}
                  className="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 font-bold focus:outline-none focus:border-red-600"
                />
                <button
                  onClick={() => handleCreateNewTournament(newTournamentTitleInput)}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-md transition shrink-0"
                >
                  新規作成
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-500">保存中の大会一覧 ({(appData.tournaments || []).length} 件)</h4>
              
              <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                {(appData.tournaments || []).map((t) => {
                  const isActive = t.id === activeTournament.id;
                  const totalPlayers = (t.divisions || []).reduce((acc, d) => acc + (d.entrants?.length || 0), 0);
                  
                  return (
                    <div
                      key={t.id}
                      className={`p-3.5 rounded-2xl border transition flex items-center justify-between gap-3 ${
                        isActive
                          ? 'bg-red-50/60 border-red-500 ring-1 ring-red-500/20'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900 truncate">{t.title}</span>
                          {isActive && (
                            <span className="px-2 py-0.5 text-[10px] font-black rounded-full bg-red-600 text-white shrink-0">
                              選択中
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-3">
                          <span>部門数: {t.divisions?.length || 0}</span>
                          <span>総選手/チーム数: {totalPlayers}</span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-1 shrink-0">
                        {!isActive && (
                          <button
                            onClick={() => handleSwitchTournament(t.id)}
                            className="px-3 py-1.5 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-xl shadow-sm transition"
                          >
                            切り替え
                          </button>
                        )}
                        <button
                          onClick={() => handleDuplicateTournament(t)}
                          className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
                          title="設定を引き継いで複製"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        {(appData.tournaments || []).length > 1 && (
                          <button
                            onClick={() => handleDeleteTournament(t.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                            title="大会を削除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-200">
              <button
                onClick={() => setShowTournamentManager(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs text-slate-700 font-bold"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- EDIT PLAYER / TEAM MODAL --- */}
      {editingEntrant && !isViewerMode && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-sm w-full p-6 shadow-2xl">
            <h3 className="text-sm font-bold text-slate-900 mb-4">
              {isTeamDivision ? 'チーム情報の編集' : '選手情報の編集'}
            </h3>

            <div className="space-y-3 mb-5">
              <div>
                <label className="text-xs text-slate-500 font-bold">{isTeamDivision ? 'チーム名' : '氏名'}</label>
                <input
                  type="text"
                  value={editingEntrant.name}
                  onChange={(e) => setEditingEntrant({ ...editingEntrant, name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2 text-xs text-slate-900 font-bold"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 font-bold">所属</label>
                <input
                  type="text"
                  value={editingEntrant.dojo || ""}
                  onChange={(e) => setEditingEntrant({ ...editingEntrant, dojo: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2 text-xs text-slate-900"
                />
              </div>
              <div>
                <label className="flex items-center space-x-2 bg-slate-50 border border-slate-300 rounded-xl p-2.5 cursor-pointer select-none mt-1">
                  <input
                    type="checkbox"
                    checked={editingEntrant.seed > 0}
                    onChange={(e) => {
                      const isChecked = e.target.checked;
                      let newSeed = 0;
                      if (isChecked) {
                        if (editingEntrant.seed > 0) {
                          newSeed = editingEntrant.seed;
                        } else {
                          const currentMaxSeed = Math.max(0, ...activeDivision.entrants.map(p => p.seed || 0));
                          newSeed = currentMaxSeed + 1;
                        }
                      }
                      setEditingEntrant({ ...editingEntrant, seed: newSeed });
                    }}
                    className="w-4 h-4 accent-red-600 rounded cursor-pointer"
                  />
                  <span className="text-xs font-bold text-red-700">シード枠にする</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setEditingEntrant(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-xs text-slate-700 font-bold hover:bg-slate-200"
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  updateActiveTournament(t => ({
                    ...t,
                    divisions: t.divisions.map(d => d.id === t.activeDivisionId ? {
                      ...d,
                      entrants: d.entrants.map(e => e.id === editingEntrant.id ? editingEntrant : e)
                    } : d)
                  }));
                  setEditingEntrant(null);
                  showToast("情報を保存しました");
                }}
                className="px-4 py-2 rounded-xl bg-red-600 text-xs text-white font-bold hover:bg-red-700 shadow-md"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- DIVISION EDIT / ADD MODAL --- */}
      {divisionModal && !isViewerMode && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-red-600" />
                {divisionModal.id ? '部門設定の変更' : '新しい部門の追加'}
              </h3>
              <button onClick={() => setDivisionModal(null)} className="text-slate-400 hover:text-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-slate-500 block mb-1 font-bold">部門名称</label>
                <input
                  type="text"
                  placeholder="部門名称を入力"
                  value={divisionModal.name}
                  onChange={(e) => setDivisionModal({ ...divisionModal, name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:border-red-600 font-bold"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs text-slate-500 block mb-1.5 font-bold">競技種別</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDivisionModal({ ...divisionModal, type: 'individual' })}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                      divisionModal.type === 'individual'
                        ? 'bg-red-50 border-red-600 text-red-700 shadow-sm'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    個人戦
                  </button>

                  <button
                    type="button"
                    onClick={() => setDivisionModal({ ...divisionModal, type: 'team' })}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                      divisionModal.type === 'team'
                        ? 'bg-red-50 border-red-600 text-red-700 shadow-sm'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    <Shield className="w-3.5 h-3.5" />
                    団体戦
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              {divisionModal.id && activeTournament.divisions.length > 1 ? (
                <button
                  onClick={() => {
                    handleDeleteDivision(divisionModal.id);
                    setDivisionModal(null);
                  }}
                  className="px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold border border-red-200 flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  削除
                </button>
              ) : <div />}

              <div className="flex space-x-2">
                <button
                  onClick={() => setDivisionModal(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-xs text-slate-700 font-bold"
                >
                  キャンセル
                </button>
                <button
                  onClick={() => {
                    if (divisionModal.id) {
                      handleRenameDivision(divisionModal.id, divisionModal.name, divisionModal.type);
                    } else {
                      handleAddDivision(divisionModal.name, divisionModal.type);
                    }
                    setDivisionModal(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-xs text-white font-bold shadow-md"
                >
                  {divisionModal.id ? '保存' : '追加'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- MATCH JUDGEMENT VISUAL MODAL --- */}
      {selectedMatch && !isViewerMode && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <div>
                <span className="text-xs font-bold text-red-600">
                  {selectedMatch.isThirdPlace ? '3位決定戦' : getRoundTitle(selectedMatch.round, maxRound)}
                </span>
                <h3 className="text-base font-bold text-slate-900">
                  {isTeamDivision ? '団体対抗戦 (5名) 挙旗・結果入力' : '審判挙旗・勝敗判定入力'}
                </h3>
              </div>
              <button onClick={() => setSelectedMatch(null)} className="text-slate-400 hover:text-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            {isTeamDivision ? (
              <div className="space-y-4">
                <div className="grid grid-cols-5 gap-1 bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
                  {TEAM_POSITIONS.map((pos, idx) => {
                    const g = teamGames[idx] || { redFlags: 3, whiteFlags: 0, winner: 'red' };
                    const isRedG = g.winner === 'red';
                    const isWhiteG = g.winner === 'white';

                    let posText = `${g.redFlags}-${g.whiteFlags}`;
                    if (g.note === 'red_absent' || (isWhiteG && g.redFlags === 0 && g.whiteFlags === 0)) {
                      posText = '赤欠場';
                    } else if (g.note === 'white_absent' || (isRedG && g.redFlags === 0 && g.whiteFlags === 0)) {
                      posText = '白欠場';
                    } else if (g.note === 'double_absent' || (g.winner === 'draw' && g.redFlags === 0 && g.whiteFlags === 0)) {
                      posText = '両欠場';
                    }

                    return (
                      <button
                        key={pos}
                        onClick={() => setActiveTeamPosIdx(idx)}
                        className={`py-2 px-1 rounded-xl text-xs font-bold transition flex flex-col items-center border ${
                          activeTeamPosIdx === idx
                            ? 'bg-red-600 border-red-700 text-white shadow-md'
                            : isRedG ? 'bg-red-50 border-red-300 text-red-800'
                            : isWhiteG ? 'bg-white border-slate-300 text-slate-800'
                            : 'bg-white border-slate-200 text-slate-500'
                        }`}
                      >
                        <span className="text-[10px] opacity-80">{pos}</span>
                        <span className="font-mono text-[10px] font-bold">{posText}</span>
                      </button>
                    );
                  })}
                </div>

                {(() => {
                  const currentPos = TEAM_POSITIONS[activeTeamPosIdx];
                  const currentGame = teamGames[activeTeamPosIdx] || { redFlags: 3, whiteFlags: 0, winner: 'red', redPlayer: '', whitePlayer: '' };

                  const updateCurrentPosFlags = (r, w, absentNote = null) => {
                    setTeamGames(prev => prev.map((g, idx) => idx === activeTeamPosIdx ? {
                      ...g,
                      redFlags: r,
                      whiteFlags: w,
                      note: absentNote,
                      winner: absentNote === 'red_absent' ? 'white' : (absentNote === 'white_absent' ? 'red' : (absentNote === 'double_absent' ? 'draw' : (r > w ? 'red' : (w > r ? 'white' : 'draw'))))
                    } : g));
                  };

                  const updateCurrentPosPlayers = (redPlayerName, whitePlayerName) => {
                    setTeamGames(prev => prev.map((g, idx) => idx === activeTeamPosIdx ? {
                      ...g,
                      redPlayer: redPlayerName !== undefined ? redPlayerName : g.redPlayer,
                      whitePlayer: whitePlayerName !== undefined ? whitePlayerName : g.whitePlayer
                    } : g));
                  };

                  return (
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-4">
                      <div className="flex flex-wrap justify-between items-center border-b border-slate-200 pb-2 gap-2">
                        <span className="text-xs font-bold text-red-600">【{currentPos} の対戦】</span>
                        <div className="flex flex-wrap gap-1">
                          <button
                            onClick={() => updateCurrentPosFlags(3, 0)}
                            className="px-2 py-1 bg-red-600 text-white rounded-lg text-[10px] font-bold shadow-sm"
                          >
                            赤 3-0
                          </button>
                          <button
                            onClick={() => updateCurrentPosFlags(2, 1)}
                            className="px-2 py-1 bg-red-500 text-white rounded-lg text-[10px] font-bold shadow-sm"
                          >
                            赤 2-1
                          </button>
                          <button
                            onClick={() => updateCurrentPosFlags(1, 2)}
                            className="px-2 py-1 bg-slate-700 text-white rounded-lg text-[10px] font-bold shadow-sm"
                          >
                            白 2-1
                          </button>
                          <button
                            onClick={() => updateCurrentPosFlags(0, 3)}
                            className="px-2 py-1 bg-slate-900 text-white rounded-lg text-[10px] font-bold shadow-sm"
                          >
                            白 3-0
                          </button>
                          <button
                            onClick={() => updateCurrentPosFlags(0, 0, 'red_absent')}
                            className="px-2 py-1 bg-red-100 text-red-800 border border-red-300 rounded-lg text-[10px] font-bold"
                          >
                            赤欠場
                          </button>
                          <button
                            onClick={() => updateCurrentPosFlags(0, 0, 'white_absent')}
                            className="px-2 py-1 bg-slate-200 text-slate-800 border border-slate-300 rounded-lg text-[10px] font-bold"
                          >
                            白欠場
                          </button>
                        </div>
                      </div>

                      {/* Red Side */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2 truncate">
                            <span className="px-2 py-0.5 rounded bg-red-600 text-white font-bold text-xs shrink-0">赤</span>
                            <span className="text-xs font-bold text-slate-900 truncate">
                              {getPlayer(selectedMatch.playerRedId)?.name || '未定'}
                            </span>
                          </div>
                          <div className="flex gap-1.5">
                            {[1, 2, 3].map(num => (
                              <div
                                key={num}
                                onClick={() => updateCurrentPosFlags(num, 3 - num)}
                                className={`w-9 h-9 rounded-xl cursor-pointer transition border ${
                                  num <= currentGame.redFlags
                                    ? 'bg-red-600 border-red-700 shadow-md scale-105'
                                    : 'bg-white border-slate-300'
                                }`}
                              />
                            ))}
                          </div>
                        </div>

                        <input
                          type="text"
                          placeholder={`${currentPos} 赤選手名`}
                          value={currentGame.redPlayer || ''}
                          onChange={(e) => updateCurrentPosPlayers(e.target.value, undefined)}
                          className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs text-slate-900 focus:outline-none focus:border-red-600"
                        />
                      </div>

                      {/* White Side */}
                      <div className="space-y-2 pt-2 border-t border-slate-200">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2 truncate">
                            <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-bold text-xs shrink-0">白</span>
                            <span className="text-xs font-bold text-slate-900 truncate">
                              {getPlayer(selectedMatch.playerWhiteId)?.name || '未定'}
                            </span>
                          </div>
                          <div className="flex gap-1.5">
                            {[1, 2, 3].map(num => (
                              <div
                                key={num}
                                onClick={() => updateCurrentPosFlags(3 - num, num)}
                                className={`w-9 h-9 rounded-xl cursor-pointer transition border ${
                                  num <= currentGame.whiteFlags
                                    ? 'bg-slate-800 border-slate-900 shadow-md scale-105'
                                    : 'bg-white border-slate-300'
                                }`}
                              />
                            ))}
                          </div>
                        </div>

                        <input
                          type="text"
                          placeholder={`${currentPos} 白選手名`}
                          value={currentGame.whitePlayer || ''}
                          onChange={(e) => updateCurrentPosPlayers(undefined, e.target.value)}
                          className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs text-slate-900 focus:outline-none focus:border-slate-600"
                        />
                      </div>
                    </div>
                  );
                })()}

                <div className="bg-slate-100 p-3 rounded-xl border border-slate-200 flex justify-between items-center text-xs">
                  <span className="text-slate-600 font-bold">現在のチーム勝敗集計:</span>
                  <div className="font-mono font-bold text-red-600 text-sm">
                    赤 {teamGames.filter(g => g.winner === 'red').length}勝 vs 白 {teamGames.filter(g => g.winner === 'white').length}勝
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <span className="text-xs text-slate-500 font-bold">一括入力ショートカット:</span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <button
                      onClick={() => { setRedFlagCount(3); setWhiteFlagCount(0); }}
                      className="py-2 px-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition shadow-sm"
                    >
                      赤 3 - 0
                    </button>
                    <button
                      onClick={() => { setRedFlagCount(2); setWhiteFlagCount(1); }}
                      className="py-2 px-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-xs font-bold transition shadow-sm"
                    >
                      赤 2 - 1
                    </button>
                    <button
                      onClick={() => { setRedFlagCount(1); setWhiteFlagCount(2); }}
                      className="py-2 px-2 bg-slate-700 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition shadow-sm"
                    >
                      白 2 - 1
                    </button>
                    <button
                      onClick={() => { setRedFlagCount(0); setWhiteFlagCount(3); }}
                      className="py-2 px-2 bg-slate-900 hover:bg-black text-white font-bold rounded-xl text-xs transition shadow-sm"
                    >
                      白 3 - 0
                    </button>
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="px-2 py-0.5 rounded bg-red-600 text-white font-bold text-xs">赤</span>
                      <span className="text-sm font-bold text-slate-900 truncate max-w-[140px]">
                        {getPlayer(selectedMatch.playerRedId)?.name || '未定'}
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      {[1, 2, 3].map(num => (
                        <div
                          key={num}
                          onClick={() => {
                            setRedFlagCount(num);
                            setWhiteFlagCount(3 - num);
                          }}
                          className={`w-10 h-10 rounded-xl cursor-pointer transition border ${
                            num <= redFlagCount
                              ? 'bg-red-600 border-red-700 shadow-md scale-105'
                              : 'bg-white border-slate-300 hover:border-slate-400'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                    <div className="flex items-center space-x-2">
                      <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-bold text-xs">白</span>
                      <span className="text-sm font-bold text-slate-900 truncate max-w-[140px]">
                        {getPlayer(selectedMatch.playerWhiteId)?.name || '未定'}
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      {[1, 2, 3].map(num => (
                        <div
                          key={num}
                          onClick={() => {
                            setWhiteFlagCount(num);
                            setRedFlagCount(3 - num);
                          }}
                          className={`w-10 h-10 rounded-xl cursor-pointer transition border ${
                            num <= whiteFlagCount
                              ? 'bg-slate-800 border-slate-900 shadow-md scale-105'
                              : 'bg-white border-slate-300 hover:border-slate-400'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="space-y-1">
              <label className="text-xs text-slate-600 font-bold block">勝敗の備考・メモ (任意):</label>
              <input
                type="text"
                placeholder="延長戦、反則注意、代表戦など"
                value={matchNote}
                onChange={(e) => setMatchNote(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-red-600 font-bold"
              />
            </div>

            <div className="space-y-1">
              <span className="text-xs text-slate-600 font-bold">当日の欠場・不戦処理:</span>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => handleSaveMatchJudgement(selectedMatch.playerWhiteId, "赤欠場 (白不戦勝)")}
                  className="py-2 px-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 rounded-xl text-xs font-bold transition"
                >
                  赤欠場 ➡ 白不戦勝
                </button>
                <button
                  onClick={() => handleSaveMatchJudgement(selectedMatch.playerRedId, "白欠場 (赤不戦勝)")}
                  className="py-2 px-2 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 rounded-xl text-xs font-bold transition"
                >
                  白欠場 ➡ 赤不戦勝
                </button>
                <button
                  onClick={() => handleSaveMatchJudgement('DOUBLE_ABSENT', "両者欠場")}
                  className="py-2 px-2 bg-slate-200 hover:bg-slate-300 border border-slate-400 text-slate-800 rounded-xl text-xs font-bold transition"
                >
                  両者欠場 (不戦敗)
                </button>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-200">
              <button
                onClick={() => setSelectedMatch(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-xs text-slate-700 font-bold"
              >
                キャンセル
              </button>
              <button
                onClick={() => handleSaveMatchJudgement()}
                className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-xs text-white font-bold shadow-md"
              >
                判定を保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MANUAL BUILD BRACKET MODAL --- */}
      {showManualBuildModal && !isViewerMode && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-red-600" />
                対戦組み合わせ・手動構築モード
              </h3>
              <button onClick={() => setShowManualBuildModal(false)} className="text-slate-400 hover:text-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200">
                <span className="text-xs text-slate-700 font-bold">トーナメント枠数:</span>
                <div className="flex gap-2">
                  {[4, 8, 16, 32, 64].map(sz => (
                    <button
                      key={sz}
                      onClick={() => handleManualSizeChange(sz)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold border transition ${
                        manualBracketSize === sz
                          ? 'bg-red-600 border-red-700 text-white shadow-sm'
                          : 'bg-white border-slate-300 text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {sz}枠
                    </button>
                  ))}
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                {Array.from({ length: manualBracketSize / 2 }, (_, pairIdx) => {
                  const idxA = pairIdx * 2;
                  const idxB = pairIdx * 2 + 1;
                  return (
                    <div key={pairIdx} className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                      <span className="text-[10px] font-bold text-slate-500 block">1回戦 第{pairIdx + 1}対戦組 (枠 {idxA + 1} vs 枠 {idxB + 1})</span>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-red-600 font-bold block mb-0.5">赤 (枠 {idxA + 1})</label>
                          <select
                            value={manualSlots[idxA] || ""}
                            onChange={(e) => {
                              const val = e.target.value || null;
                              setManualSlots(prev => {
                                const copy = [...prev];
                                copy[idxA] = val;
                                return copy;
                              });
                            }}
                            className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs text-slate-900"
                          >
                            <option value="">-- シード枠 --</option>
                            {activeDivision.entrants.map(e => (
                              <option key={e.id} value={e.id}>
                                {e.name} ({e.dojo || '所属なし'}) {e.seed ? `[シード]` : ''}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="text-[10px] text-slate-700 font-bold block mb-0.5">白 (枠 {idxB + 1})</label>
                          <select
                            value={manualSlots[idxB] || ""}
                            onChange={(e) => {
                              const val = e.target.value || null;
                              setManualSlots(prev => {
                                const copy = [...prev];
                                copy[idxB] = val;
                                return copy;
                              });
                            }}
                            className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs text-slate-900"
                          >
                            <option value="">-- シード枠 --</option>
                            {activeDivision.entrants.map(e => (
                              <option key={e.id} value={e.id}>
                                {e.name} ({e.dojo || '所属なし'}) {e.seed ? `[シード]` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-200">
              <button
                onClick={() => setShowManualBuildModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-xs text-slate-700 font-bold"
              >
                キャンセル
              </button>
              <button
                onClick={handleSaveManualBuild}
                className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-xs text-white font-bold shadow-md"
              >
                この組み合わせでトーナメント生成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- SLOT DIRECT EDIT MODAL --- */}
      {slotEditMatch && !isViewerMode && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-red-600" />
                対戦カードの枠手動差し替え
              </h3>
              <button onClick={() => setSlotEditMatch(null)} className="text-slate-400 hover:text-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-red-600 font-bold block mb-1">赤選手 / チーム</label>
                <select
                  value={slotEditMatch.playerRedId || ""}
                  onChange={(e) => {
                    const newId = e.target.value || null;
                    handleSwapRound1Slot(slotEditMatch.id, 'red', newId);
                    setSlotEditMatch(null);
                    showToast("赤選手を変更しました");
                  }}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none font-bold"
                >
                  <option value="">-- シード枠 --</option>
                  {activeDivision.entrants.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.name} ({e.dojo || '所属なし'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-700 font-bold block mb-1">白選手 / チーム</label>
                <select
                  value={slotEditMatch.playerWhiteId || ""}
                  onChange={(e) => {
                    const newId = e.target.value || null;
                    handleSwapRound1Slot(slotEditMatch.id, 'white', newId);
                    setSlotEditMatch(null);
                    showToast("白選手を変更しました");
                  }}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none font-bold"
                >
                  <option value="">-- シード枠 --</option>
                  {activeDivision.entrants.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.name} ({e.dojo || '所属なし'})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSlotEditMatch(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-xs text-slate-700 font-bold"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- VIEWER URL MODAL --- */}
      {showQRModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 text-center">
            <div className="flex justify-between items-center pb-2 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <QrCode className="w-4 h-4 text-red-600" />
                閲覧用・管理者用URL
              </h3>
              <button onClick={() => setShowQRModal(false)} className="text-slate-400 hover:text-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-left">
              <div className={`p-2.5 rounded-xl text-xs font-bold border ${
                activeTournament.isPublicViewerEnabled
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                  : 'bg-red-50 border-red-300 text-red-700'
              }`}>
                公開状態: {activeTournament.isPublicViewerEnabled ? '● 現在公開中 (閲覧可能)' : '✕ 現在非公開 (閲覧不可)'}
              </div>

              {/* 閲覧用URL (編集・管理不可) */}
              <div className="space-y-1.5 bg-slate-50 p-3 rounded-2xl border border-slate-200">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1">
                    <Eye className="w-3.5 h-3.5 text-amber-600" />
                    閲覧用URL (編集・管理不可)
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  観客・選手向けの読み取り専用リンクです。管理モードへの切替はロックされます。
                </p>
                <div className="bg-white p-2.5 rounded-xl border border-slate-300 text-left font-mono text-[11px] text-red-700 break-all select-all font-bold">
                  {getTournamentURL('view')}
                </div>
                <button
                  onClick={async () => {
                    const copied = await copyToClipboard(getTournamentURL('view'));
                    if (copied) {
                      showToast("閲覧用URLをクリップボードにコピーしました", "success");
                    } else {
                      showToast("URLを選択して手動でコピーしてください", "info");
                    }
                  }}
                  className="w-full py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-sm transition flex items-center justify-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  閲覧用URLをコピー
                </button>
              </div>

              {/* 管理者用URL (編集・管理可能) */}
              {!isViewerMode && (
                <div className="space-y-1.5 bg-slate-50 p-3 rounded-2xl border border-slate-200">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 flex items-center gap-1">
                      <Shield className="w-3.5 h-3.5 text-slate-700" />
                      管理者用URL (編集・管理可能)
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    運営スタッフ・審判員向けの全機能（試合結果の入力・トーナメント組み換え）利用可能リンクです。
                  </p>
                  <div className="bg-white p-2.5 rounded-xl border border-slate-300 text-left font-mono text-[11px] text-slate-800 break-all select-all font-bold">
                    {getTournamentURL('admin')}
                  </div>
                  <button
                    onClick={async () => {
                      const copied = await copyToClipboard(getTournamentURL('admin'));
                      if (copied) {
                        showToast("管理者用URLをクリップボードにコピーしました", "success");
                      } else {
                        showToast("URLを選択して手動でコピーしてください", "info");
                      }
                    }}
                    className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs shadow-sm transition flex items-center justify-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    管理者用URLをコピー
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}