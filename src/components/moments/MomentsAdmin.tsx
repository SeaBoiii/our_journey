import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SubmitEvent,
} from "react";

import { MOMENTS_CONFIG } from "../../config/moments";
import { MomentsApiError } from "../../lib/moments/api";
import {
  getAdminSession,
  isAdminPageEmbedded,
  isAdminAuthConfigured,
  sendAdminMagicLink,
  signOutAdmin,
  subscribeToAdminSession,
  verifyAdminAuthorization,
} from "../../lib/moments/admin-auth";
import {
  mergeMomentsById,
  releaseMomentObjectUrls,
  sortMomentsNewestFirst,
} from "../../lib/moments/gallery";
import type { Moment, MomentStatus } from "../../lib/moments/types";
import {
  getAdminMoments,
  getMomentErrorCode,
  getMomentErrorMessage,
  updateMomentStatus,
} from "../../lib/moments/upload";
import AdminMomentCard from "./AdminMomentCard";
import styles from "./MomentsAdmin.module.css";

type StatusFilter = MomentStatus | "all";
type AdminAccessPhase =
  | "checking"
  | "signed-out"
  | "link-sent"
  | "unauthorized"
  | "authorized"
  | "configuration-error";
type FrameAccessPhase = "checking" | "top-level" | "embedded";
type LoadErrorSource = "reload" | "more";

const FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "hidden", label: "Hidden" },
];
const ADMIN_PAGE_SIZE = 20;

function AdminGateArtwork() {
  return (
    <span className={styles.gateMark} aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <path d="M16 3.5 5.5 9v6.2c0 6 4.4 10.4 10.5 12.8 6.1-2.4 10.5-6.8 10.5-12.8V9L16 3.5Z" />
        <path d="M11.7 15.4 14.5 18l5.9-6.2" />
      </svg>
    </span>
  );
}

export default function MomentsAdmin() {
  const isMock = MOMENTS_CONFIG.backendProvider === "mock";
  const [accessPhase, setAccessPhase] = useState<AdminAccessPhase>(
    isMock ? "authorized" : "checking",
  );
  const [frameAccess, setFrameAccess] = useState<FrameAccessPhase>(
    isMock ? "top-level" : "checking",
  );
  const [adminEmail, setAdminEmail] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [loading, setLoading] = useState(isMock);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [errorSource, setErrorSource] = useState<LoadErrorSource>("reload");
  const [busy, setBusy] = useState<{ id: string; status: MomentStatus } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const momentsRef = useRef<Moment[]>([]);
  const loadGenerationRef = useRef(0);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    momentsRef.current = moments;
  }, [moments]);

  useEffect(() => {
    if (isMock) return;
    setFrameAccess(isAdminPageEmbedded(window) ? "embedded" : "top-level");
  }, [isMock]);

  const authorizeSession = useCallback(
    async (accessToken: string, email?: string) => {
      setAccessPhase("checking");
      setAuthError("");
      try {
        const identity = await verifyAdminAuthorization({ accessToken });
        setAdminEmail(identity.user?.email ?? email ?? "");
        setAccessPhase(identity.authorized ? "authorized" : "unauthorized");
        if (identity.authorized && typeof window !== "undefined") {
          const cleanUrl = new URL(window.location.href);
          if (cleanUrl.search || cleanUrl.hash) {
            cleanUrl.search = "";
            cleanUrl.hash = "";
            window.history.replaceState({}, "", cleanUrl);
          }
        }
      } catch (authFailure) {
        if (
          authFailure instanceof MomentsApiError &&
          (authFailure.code === "ACCESS_DENIED" || authFailure.status === 403)
        ) {
          setAdminEmail(email ?? "");
          setAccessPhase("unauthorized");
          return;
        }
        setAuthError("We couldn’t confirm admin access just now. Please try again.");
        setAccessPhase("signed-out");
      }
    },
    [],
  );

  useEffect(() => {
    if (isMock || frameAccess !== "top-level") return;
    if (!isAdminAuthConfigured()) {
      setAccessPhase("configuration-error");
      return;
    }

    let active = true;
    void getAdminSession()
      .then((session) => {
        if (!active) return;
        if (session?.access_token) {
          void authorizeSession(session.access_token, session.user.email);
        } else {
          setAccessPhase("signed-out");
        }
      })
      .catch(() => {
        if (active) {
          setAuthError("We couldn’t restore your admin session. Please sign in again.");
          setAccessPhase("signed-out");
        }
      });

    const unsubscribe = subscribeToAdminSession((event, session) => {
      if (!active) return;
      if (event === "SIGNED_OUT" || !session) {
        loadGenerationRef.current += 1;
        loadingMoreRef.current = false;
        setAccessPhase("signed-out");
        setMoments([]);
        setNextOffset(null);
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        void authorizeSession(session.access_token, session.user.email);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [authorizeSession, frameAccess, isMock]);

  const handleLoadError = useCallback(
    (loadError: unknown) => {
      const errorCode = getMomentErrorCode(loadError);
      if (!isMock && errorCode === "AUTH_REQUIRED") {
        setAccessPhase("signed-out");
      } else if (!isMock && errorCode === "ACCESS_DENIED") {
        setAccessPhase("unauthorized");
      }
      if (
        !isMock &&
        (errorCode === "AUTH_REQUIRED" || errorCode === "ACCESS_DENIED")
      ) {
        loadGenerationRef.current += 1;
        loadingMoreRef.current = false;
        setMoments((currentMoments) => {
          releaseMomentObjectUrls(currentMoments);
          return [];
        });
        setNextOffset(null);
      }
      setError(getMomentErrorMessage(loadError));
    },
    [isMock],
  );

  const loadMoments = useCallback(async () => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    loadingMoreRef.current = false;
    setLoading(true);
    setLoadingMore(false);
    setErrorSource("reload");
    setError("");

    try {
      const page = await getAdminMoments({
        status: "all",
        limit: ADMIN_PAGE_SIZE,
        offset: 0,
      });
      if (loadGenerationRef.current !== generation) {
        releaseMomentObjectUrls(page.moments);
        return;
      }
      setMoments((previousMoments) => {
        releaseMomentObjectUrls(previousMoments);
        return [...page.moments];
      });
      setNextOffset(page.nextOffset);
    } catch (loadError) {
      if (loadGenerationRef.current === generation) {
        handleLoadError(loadError);
      }
    } finally {
      if (loadGenerationRef.current === generation) setLoading(false);
    }
  }, [handleLoadError]);

  const loadMoreMoments = useCallback(async () => {
    if (nextOffset === null || loadingMoreRef.current) return;
    const generation = loadGenerationRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setErrorSource("more");
    setError("");
    try {
      const page = await getAdminMoments({
        status: "all",
        limit: ADMIN_PAGE_SIZE,
        offset: nextOffset,
      });
      if (loadGenerationRef.current !== generation) {
        releaseMomentObjectUrls(page.moments);
        return;
      }
      setMoments((currentMoments) =>
        mergeMomentsById(currentMoments, page.moments),
      );
      setNextOffset(page.nextOffset);
    } catch (loadError) {
      if (loadGenerationRef.current === generation) {
        handleLoadError(loadError);
      }
    } finally {
      if (loadGenerationRef.current === generation) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [handleLoadError, nextOffset]);

  useEffect(() => {
    if (accessPhase !== "authorized") return;
    void loadMoments();
    return () => {
      loadGenerationRef.current += 1;
      loadingMoreRef.current = false;
      releaseMomentObjectUrls(momentsRef.current);
    };
  }, [accessPhase, loadMoments]);

  const counts = useMemo(() => {
    const result: Record<StatusFilter, number> = {
      all: moments.length,
      pending: 0,
      approved: 0,
      rejected: 0,
      hidden: 0,
    };
    for (const moment of moments) result[moment.status] += 1;
    return result;
  }, [moments]);

  const visibleMoments = useMemo(
    () =>
      sortMomentsNewestFirst(
        filter === "all"
          ? moments
          : moments.filter((moment) => moment.status === filter),
      ),
    [filter, moments],
  );

  const handleChangeStatus = useCallback(
    async (moment: Moment, status: MomentStatus) => {
      setBusy({ id: moment.id, status });
      setError("");
      setAnnouncement("");

      try {
        const updatedMoment = await updateMomentStatus(moment.id, status);
        setMoments((currentMoments) =>
          currentMoments.map((candidate) => {
            if (candidate.id !== moment.id) return candidate;
            releaseMomentObjectUrls(candidate);
            return updatedMoment;
          }),
        );
        const action =
          moment.status === "rejected" && status === "pending"
            ? "restored to the pending queue"
            : moment.status === "hidden" && status === "approved"
              ? "restored"
              : status === "approved"
                ? "approved"
            : status === "rejected"
              ? "rejected"
              : "hidden";
        setAnnouncement(`${moment.guestName || "Guest"}'s moment was ${action}.`);
      } catch (updateError) {
        const errorCode = getMomentErrorCode(updateError);
        if (!isMock && errorCode === "AUTH_REQUIRED") {
          setAccessPhase("signed-out");
        } else if (!isMock && errorCode === "ACCESS_DENIED") {
          setAccessPhase("unauthorized");
        }
        setError(getMomentErrorMessage(updateError));
      } finally {
        setBusy(null);
      }
    },
    [isMock],
  );

  async function handleMagicLink(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adminEmail.trim() || authBusy) return;
    setAuthBusy(true);
    setAuthError("");
    try {
      await sendAdminMagicLink(adminEmail);
      setAccessPhase("link-sent");
    } catch {
      setAuthError(
        "The sign-in service is temporarily unavailable. Please try again later.",
      );
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSignOut() {
    setAuthBusy(true);
    setAuthError("");
    try {
      await signOutAdmin();
      loadGenerationRef.current += 1;
      loadingMoreRef.current = false;
      setAccessPhase("signed-out");
      setAdminEmail("");
      setMoments((currentMoments) => {
        releaseMomentObjectUrls(currentMoments);
        return [];
      });
      setNextOffset(null);
    } catch {
      setAuthError("We couldn’t sign out just now. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  }

  if (frameAccess === "embedded") {
    return (
      <section className={styles.gate} aria-labelledby="admin-embedded-title">
        <AdminGateArtwork />
        <p className={styles.gateEyebrow}>Private access</p>
        <h2 id="admin-embedded-title">Open this page directly</h2>
        <p>
          For your security, admin sign-in and moderation are unavailable inside
          an embedded page. Open this address in its own browser tab or window.
        </p>
      </section>
    );
  }

  if (frameAccess === "checking" || accessPhase === "checking") {
    return (
      <section className={styles.gate} aria-label="Checking admin access" aria-busy="true">
        <AdminGateArtwork />
        <h2>Opening the private gallery</h2>
        <p>Confirming your invitation to moderate Moments…</p>
        <span className={styles.gateLoader} aria-hidden="true" />
      </section>
    );
  }

  if (accessPhase === "configuration-error") {
    return (
      <section className={styles.gate} aria-labelledby="admin-config-title">
        <AdminGateArtwork />
        <h2 id="admin-config-title">Admin access is not configured</h2>
        <p>The Supabase public URL and anonymous key must be added to this build.</p>
      </section>
    );
  }

  if (accessPhase === "signed-out" || accessPhase === "link-sent") {
    const linkSent = accessPhase === "link-sent";
    return (
      <section className={styles.gate} aria-labelledby="admin-sign-in-title">
        <AdminGateArtwork />
        <p className={styles.gateEyebrow}>Private access</p>
        <h2 id="admin-sign-in-title">
          {linkSent ? "Check your email" : "Sign in to Moments"}
        </h2>
        <p>
          {linkSent
            ? "If this address is authorized, a private sign-in link is on its way."
            : "We’ll send a one-time link to an authorized administrator."}
        </p>
        <form className={styles.signInForm} onSubmit={handleMagicLink}>
          <label htmlFor="moments-admin-email">Email address</label>
          <input
            id="moments-admin-email"
            type="email"
            autoComplete="email"
            required
            value={adminEmail}
            onChange={(event) => setAdminEmail(event.currentTarget.value)}
            disabled={authBusy}
          />
          <button type="submit" disabled={authBusy || !adminEmail.trim()}>
            {authBusy ? "Sending…" : linkSent ? "Send another link" : "Email me a sign-in link"}
          </button>
        </form>
        {authError ? <p className={styles.authError} role="alert">{authError}</p> : null}
      </section>
    );
  }

  if (accessPhase === "unauthorized") {
    return (
      <section className={styles.gate} aria-labelledby="admin-denied-title">
        <AdminGateArtwork />
        <p className={styles.gateEyebrow}>Private access</p>
        <h2 id="admin-denied-title">Access not granted</h2>
        <p>
          {adminEmail || "This account"} is signed in, but it is not on the Moments administrator list.
        </p>
        <button className={styles.gateButton} type="button" onClick={() => void handleSignOut()} disabled={authBusy}>
          {authBusy ? "Signing out…" : "Sign out and try another account"}
        </button>
        {authError ? <p className={styles.authError} role="alert">{authError}</p> : null}
      </section>
    );
  }

  if (loading) {
    return (
      <section className={styles.shell} aria-label="Loading moderation queue" aria-busy="true">
        <div className={styles.skeletonFilters} />
        <div className={styles.grid}>
          {Array.from({ length: 4 }, (_, index) => (
            <div className={styles.skeletonCard} key={index} />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className={styles.shell} aria-label={isMock ? "Mock Moments moderation queue" : "Moments moderation queue"}>
      {!isMock ? (
        <div className={styles.adminSession}>
          <span>{adminEmail || "Authorized administrator"}</span>
          <button type="button" onClick={() => void handleSignOut()} disabled={authBusy}>Sign out</button>
        </div>
      ) : null}
      <div className={styles.toolbar}>
        <div className={styles.filters} role="group" aria-label="Filter moments by status">
          {FILTERS.map((item) => (
            <button
              type="button"
              key={item.value}
              aria-pressed={filter === item.value}
              aria-label={`${item.label}: ${counts[item.value]} loaded${nextOffset !== null ? ", more available" : ""}`}
              onClick={() => setFilter(item.value)}
            >
              <span>{item.label}</span>
              <strong>
                {counts[item.value]}
                {nextOffset !== null ? "+" : ""}
              </strong>
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => void loadMoments()}
          disabled={loadingMore}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 6.5V3m0 0h-3.5M16 3a7 7 0 1 0 1 8.6" /></svg>
          Refresh
        </button>
      </div>

      <p className={styles.announcement} aria-live="polite">{announcement}</p>

      {error ? (
        <div className={styles.error} role="alert">
          <p>{error}</p>
          <button
            type="button"
            onClick={() =>
              void (moments.length > 0 && nextOffset !== null
                ? errorSource === "more"
                  ? loadMoreMoments()
                  : loadMoments()
                : loadMoments())
            }
          >
            Try again
          </button>
        </div>
      ) : null}

      {!error && visibleMoments.length === 0 ? (
        <div className={styles.empty}>
          <span aria-hidden="true">
            <svg viewBox="0 0 28 28"><path d="M5 8.5h4l1.4-2h7.2l1.4 2h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2Z" /><circle cx="14" cy="15" r="4" /></svg>
          </span>
          <h2>
            No {filter === "all" ? (isMock ? "local" : "shared") : filter} moments {nextOffset !== null ? "loaded yet" : "yet"}
          </h2>
          <p>
            {nextOffset !== null
              ? "More submissions are available. Load the next page to keep looking."
              : "New guest submissions will appear here when they are shared from the capture page."}
          </p>
        </div>
      ) : null}

      {visibleMoments.length > 0 ? (
        <div className={styles.grid}>
          {visibleMoments.map((moment) => (
            <AdminMomentCard
              key={moment.id}
              moment={moment}
              busyStatus={busy?.id === moment.id ? busy.status : null}
              onChangeStatus={handleChangeStatus}
            />
          ))}
        </div>
      ) : null}

      {nextOffset !== null && !error ? (
        <div className={styles.pagination}>
          <p>
            Showing {moments.length} loaded submission{moments.length === 1 ? "" : "s"}.
          </p>
          <button
            type="button"
            onClick={() => void loadMoreMoments()}
            disabled={loadingMore}
            aria-busy={loadingMore}
          >
            {loadingMore ? "Loading more..." : "Load more"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
