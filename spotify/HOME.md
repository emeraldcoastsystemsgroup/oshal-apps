# Spotify Home and connected planning

The card shows the caller's saved genres and artists from `spotify_profile`, with the profile's `updated_at`. It publishes no playback or playlist counters because those are provider reads, not this saved source. Future profile timestamps are excluded. Missing preference data prompts setup; a failed source is unavailable.

Incoming music planning opens a visible editable draft through disconnected and allowlist states. After connecting and refreshing, “Use in concierge” copies the edited request. Send and Create on Spotify remain explicit. Movie and meal planning are optional connected destinations; context receipt never starts playback or creates a playlist.

Home GET selects only preferences and timestamp for the signed-in subject. Notes, credentials and unrelated profile fields are not transferred. The connection requirement remains the listener's own Spotify account. Household tests cover owner isolation, bounded preferences, unavailable sources and the actual disconnected-to-connected browser flow.
