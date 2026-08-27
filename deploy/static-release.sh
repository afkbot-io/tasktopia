#!/usr/bin/env bash

is_managed_self_host_nginx_config() {
  local site_path="$1"
  local rendered_legacy_path="$2"
  grep -Fqx "# Managed by Tasktopia's self-host installer and update script." "$site_path" \
    || cmp -s "$site_path" "$rendered_legacy_path"
}

prepublish_immutable_dir() {
  local source_dir="$1"
  local target_dir="$2"
  local journal_path="${3:-}"
  local source_file relative_path target_file target_parent
  [[ -d "$source_dir" ]] || return 0
  install -d -m 0755 "$target_dir"

  if [[ -n "$journal_path" ]]; then
    install -d -m 0755 "$(dirname "$journal_path")"
    while IFS= read -r -d '' source_file; do
      relative_path="${source_file#"$source_dir"/}"
      target_file="$target_dir/$relative_path"
      if [[ ! -e "$target_file" ]]; then
        printf '%s\0' "$target_file" >> "$journal_path"
        target_parent="$(dirname "$target_file")"
        while [[ "$target_parent" == "$target_dir"/* && ! -e "$target_parent" ]]; do
          printf '%s\0' "$target_parent" >> "$journal_path.dirs"
          target_parent="$(dirname "$target_parent")"
        done
      fi
    done < <(find "$source_dir" -type f ! -name '*.map' -print0)
  fi

  while IFS= read -r -d '' source_file; do
    relative_path="${source_file#"$source_dir"/}"
    install -d -m 0755 "$target_dir/$relative_path"
  done < <(find "$source_dir" -mindepth 1 -type d -print0)

  while IFS= read -r -d '' source_file; do
    relative_path="${source_file#"$source_dir"/}"
    target_file="$target_dir/$relative_path"
    if [[ ! -e "$target_file" ]]; then
      install -d -m 0755 "$(dirname "$target_file")"
      cp -p -- "$source_file" "$target_file"
    fi
  done < <(find "$source_dir" -type f ! -name '*.map' -print0)

  while IFS= read -r -d '' source_file; do
    relative_path="${source_file#"$source_dir"/}"
    target_file="$target_dir/$relative_path"
    if [[ ! -f "$target_file" ]] || ! cmp -s "$source_file" "$target_file"; then
      echo "Immutable asset collision or incomplete copy: $relative_path" >&2
      return 1
    fi
  done < <(find "$source_dir" -type f ! -name '*.map' -print0)
}

prepublish_immutable_file() {
  local source_file="$1"
  local target_file="$2"
  install -d -m 0755 "$(dirname "$target_file")"
  if [[ -e "$target_file" ]]; then
    cmp -s "$source_file" "$target_file" || {
      echo "Immutable asset collision: $target_file" >&2
      return 1
    }
    return 0
  fi
  cp -p "$source_file" "$target_file"
}

rollback_prepublished_paths() {
  local journal_path="$1"
  local active_dir="$2"
  local journaled_path
  [[ -f "$journal_path" ]] || return 0

  while IFS= read -r -d '' journaled_path; do
    case "$journaled_path" in
      "$active_dir"/*) rm -f -- "$journaled_path" ;;
      *) echo "Ignoring unsafe prepublish journal path: $journaled_path" >&2 ;;
    esac
  done < "$journal_path"

  if [[ -f "$journal_path.dirs" ]]; then
    while IFS= read -r -d '' journaled_path; do
      case "$journaled_path" in
        "$active_dir"/*) rmdir -- "$journaled_path" 2>/dev/null || true ;;
        *) echo "Ignoring unsafe prepublish directory journal path: $journaled_path" >&2 ;;
      esac
    done < "$journal_path.dirs"
  fi
}

remove_empty_asset_parents() {
  local file_path="$1"
  local asset_root="$2"
  local parent_path
  parent_path="$(dirname "$file_path")"
  while [[ "$parent_path" == "$asset_root"/* ]]; do
    rmdir -- "$parent_path" 2>/dev/null || break
    parent_path="$(dirname "$parent_path")"
  done
}

remember_failed_asset_generation() {
  local candidate_asset_list="$1"
  local active_dir="$2"
  local release_id="$3"
  local failed_revision="${4:-}"
  local generation_dir="$active_dir/.tasktopia/failed-asset-generations"
  local generation_list="$generation_dir/$release_id.list"
  local asset_relative relative_path
  [[ -f "$candidate_asset_list" ]] || {
    echo "Failed candidate asset list is missing: $candidate_asset_list" >&2
    return 1
  }
  install -d -m 0755 "$generation_dir"
  : > "$generation_list"

  while IFS= read -r asset_relative; do
    safe_asset_relative_path "$asset_relative" || return 1
    relative_path="assets/$asset_relative"
    [[ -f "$active_dir/$relative_path" ]] || {
      echo "Failed candidate asset was not prepublished: $relative_path" >&2
      return 1
    }
    printf '%s\n' "$relative_path" >> "$generation_list"
  done < "$candidate_asset_list"

  if [[ ! -s "$generation_list" ]]; then
    rm -f -- "$generation_list"
    rm -f -- "$generation_dir/$release_id.revision"
  elif [[ "$failed_revision" =~ ^[a-f0-9]{16}$ ]]; then
    printf '%s\n' "$failed_revision" > "$generation_dir/$release_id.revision"
  fi
}

prune_failed_asset_generations() {
  local active_dir="$1"
  local retained_count="$2"
  local generation_dir="$active_dir/.tasktopia/failed-asset-generations"
  local oldest_generation oldest_mtime generation generation_mtime relative_path asset_path
  local -a generations generation_assets
  [[ -d "$generation_dir" ]] || return 0

  shopt -s nullglob
  generations=("$generation_dir"/*.list)
  while (( ${#generations[@]} > retained_count )); do
    oldest_generation=""
    oldest_mtime=""
    for generation in "${generations[@]}"; do
      generation_mtime="$(asset_path_mtime "$generation")"
      if [[ -z "$oldest_generation" ]] || (( generation_mtime < oldest_mtime )); then
        oldest_generation="$generation"
        oldest_mtime="$generation_mtime"
      fi
    done
    generation_assets=()
    while IFS= read -r relative_path; do
      safe_asset_relative_path "$relative_path" || return 1
      [[ "$relative_path" == assets/* ]] || return 1
      generation_assets+=("$relative_path")
    done < "$oldest_generation"
    rm -f -- "$oldest_generation"
    rm -f -- "${oldest_generation%.list}.revision"
    for relative_path in "${generation_assets[@]}"; do
      asset_path="$active_dir/$relative_path"
      if ! asset_path_is_retained_elsewhere "$active_dir" "$relative_path"; then
        rm -f -- "$asset_path"
        remove_empty_asset_parents "$asset_path" "$active_dir/assets"
      fi
    done
    generations=("$generation_dir"/*.list)
  done
  shopt -u nullglob
}

asset_path_is_retained_elsewhere() {
  local active_dir="$1"
  local relative_path="$2"
  local asset_relative="${relative_path#assets/}"
  local generation

  if grep -Fqx -- "$asset_relative" "$active_dir/.tasktopia/current-assets.list" 2>/dev/null \
    || grep -Fqx -- "$asset_relative" "$active_dir/.tasktopia/previous-assets.list" 2>/dev/null; then
    return 0
  fi

  for generation in "$active_dir/.tasktopia/failed-asset-generations"/*.list; do
    [[ -f "$generation" ]] || continue
    if grep -Fqx -- "$relative_path" "$generation"; then
      return 0
    fi
  done
  return 1
}

retain_failed_asset_generations() {
  local active_dir="$1"
  local incoming_dir="$2"
  local generation_dir="$active_dir/.tasktopia/failed-asset-generations"
  local incoming_generation_dir="$incoming_dir/.tasktopia/failed-asset-generations"
  local generation relative_path source_file sidecar_name
  local -a generations
  [[ -d "$generation_dir" ]] || return 0

  install -d -m 0755 "$incoming_generation_dir"
  shopt -s nullglob
  generations=("$generation_dir"/*.list)
  for generation in "${generations[@]}"; do
    while IFS= read -r relative_path; do
      safe_asset_relative_path "$relative_path" || return 1
      [[ "$relative_path" == assets/* ]] || return 1
      [[ "$relative_path" != *.map ]] || continue
      source_file="$active_dir/$relative_path"
      [[ -f "$source_file" ]] || {
        echo "Retained failed-generation asset is missing: $relative_path" >&2
        return 1
      }
      prepublish_immutable_file "$source_file" "$incoming_dir/$relative_path"
    done < "$generation"
    cp -p "$generation" "$incoming_generation_dir/${generation##*/}"
    if [[ -f "${generation%.list}.revision" ]]; then
      sidecar_name="${generation##*/}"
      sidecar_name="${sidecar_name%.list}.revision"
      cp -p "${generation%.list}.revision" "$incoming_generation_dir/$sidecar_name"
    fi
  done
  shopt -u nullglob
}

preserve_failed_prepublished_generation() {
  local candidate_asset_list="$1"
  local failed_revision="$2"
  local active_dir="$3"
  local release_id="$4"
  local asset_retained_count="$5"
  local revision_retained_count="$6"
  local current_revision previous_revision
  local failed_revision_file retained_failed_revision
  local -a retained_failed_revisions

  [[ "$failed_revision" =~ ^[a-f0-9]{16}$ \
    && -d "$active_dir/game-assets/v5/revisions/$failed_revision" ]] || {
    echo "Failed candidate asset revision is unavailable: $failed_revision" >&2
    return 1
  }
  touch "$active_dir/game-assets/v5/revisions/$failed_revision"

  remember_failed_asset_generation \
    "$candidate_asset_list" \
    "$active_dir" \
    "$release_id" \
    "$failed_revision"
  prune_failed_asset_generations "$active_dir" "$asset_retained_count"

  retained_failed_revisions=()
  for failed_revision_file in "$active_dir/.tasktopia/failed-asset-generations"/*.revision; do
    [[ -f "$failed_revision_file" ]] || continue
    retained_failed_revision="$(sed -n '1p' "$failed_revision_file")"
    [[ "$retained_failed_revision" =~ ^[a-f0-9]{16}$ ]] || return 1
    retained_failed_revisions+=("$retained_failed_revision")
  done

  current_revision="$(asset_revision_from_manifest "$active_dir/game-assets/v5/manifest.json" || true)"
  previous_revision="$(sed -n '1p' "$active_dir/.tasktopia/previous-asset-revision" 2>/dev/null || true)"
  [[ "$previous_revision" =~ ^[a-f0-9]{16}$ ]] || previous_revision=""
  if [[ "$current_revision" =~ ^[a-f0-9]{16}$ ]]; then
    prune_asset_revisions \
      "$active_dir/game-assets/v5/revisions" \
      "$current_revision" \
      "$previous_revision" \
      "$revision_retained_count" \
      "${retained_failed_revisions[@]}"
  fi
}

safe_asset_relative_path() {
  local relative_path="$1"
  local segment
  local -a segments
  [[ -n "$relative_path" && "$relative_path" != /* ]] || return 1
  IFS='/' read -r -a segments <<< "$relative_path"
  for segment in "${segments[@]}"; do
    [[ -n "$segment" && "$segment" != "." && "$segment" != ".." ]] || return 1
  done
}

record_current_asset_generation() {
  local incoming_dir="$1"
  local asset_root="$incoming_dir/assets"
  local metadata_dir="$incoming_dir/.tasktopia"
  local asset_file
  install -d -m 0755 "$metadata_dir"
  : > "$metadata_dir/current-assets.list"
  [[ -d "$asset_root" ]] || return 0
  {
    while IFS= read -r -d '' asset_file; do
      printf '%s\n' "${asset_file#"$asset_root"/}"
    done < <(find "$asset_root" -type f ! -name '*.map' -print0)
  } | LC_ALL=C sort > "$metadata_dir/current-assets.list"
}

bootstrap_static_release_from_container() {
  local container_id="$1"
  local static_dir="$2"
  local release_id="$3"
  local release_dir="$static_dir/releases/$release_id"
  local staging_dir="$static_dir/releases/.incoming-$release_id"
  local next_link="$static_dir/current.next"

  [[ -n "$container_id" ]] || {
    echo "Cannot bootstrap static release without an app container" >&2
    return 1
  }
  [[ ! -e "$release_dir" && ! -L "$release_dir" ]] || {
    echo "Static release already exists: $release_dir" >&2
    return 1
  }

  install -d -m 0755 "$static_dir/releases" "$staging_dir"
  if ! docker cp "$container_id:/app/dist/public/." "$staging_dir/"; then
    rm -rf -- "$staging_dir"
    return 1
  fi
  find "$staging_dir" -type d -exec chmod 0755 {} +
  find "$staging_dir" -type f -exec chmod 0644 {} +
  mv -- "$staging_dir" "$release_dir"
  rm -f -- "$next_link"
  ln -s "$release_dir" "$next_link"
  mv -Tf -- "$next_link" "$static_dir/current"
}

retain_active_asset_generation() {
  local active_dir="$1"
  local incoming_dir="$2"
  local generation_list="$active_dir/.tasktopia/current-assets.list"
  local previous_list="$incoming_dir/.tasktopia/previous-assets.list"
  local relative_path source_file asset_file
  install -d -m 0755 "$incoming_dir/.tasktopia"
  : > "$previous_list"

  if [[ ! -f "$generation_list" ]]; then
    prepublish_immutable_dir "$active_dir/assets" "$incoming_dir/assets"
    if [[ -d "$active_dir/assets" ]]; then
      {
        while IFS= read -r -d '' asset_file; do
          printf '%s\n' "${asset_file#"$active_dir/assets"/}"
        done < <(find "$active_dir/assets" -type f ! -name '*.map' -print0)
      } | LC_ALL=C sort > "$previous_list"
    fi
    return
  fi

  while IFS= read -r relative_path; do
    safe_asset_relative_path "$relative_path" || {
      echo "Unsafe asset generation path: $relative_path" >&2
      return 1
    }
    [[ "$relative_path" != *.map ]] || continue
    source_file="$active_dir/assets/$relative_path"
    [[ -f "$source_file" ]] || {
      echo "Active asset generation is incomplete: $relative_path" >&2
      return 1
    }
    prepublish_immutable_file "$source_file" "$incoming_dir/assets/$relative_path"
  done < "$generation_list"
  cp -p "$generation_list" "$previous_list"
}

asset_revision_from_manifest() {
  local manifest_path="$1"
  local revision
  [[ -f "$manifest_path" ]] || return 1
  revision="$(sed -nE 's/.*"assetRevision"[[:space:]]*:[[:space:]]*"([a-f0-9]{16})".*/\1/p' "$manifest_path" | head -n 1)"
  [[ "$revision" =~ ^[a-f0-9]{16}$ ]] || return 1
  printf '%s\n' "$revision"
}

asset_path_mtime() {
  local path="$1"
  if stat -c '%Y' "$path" >/dev/null 2>&1; then
    stat -c '%Y' "$path"
  else
    stat -f '%m' "$path"
  fi
}

prune_asset_revisions() {
  local revision_root="$1"
  local current_revision="$2"
  local previous_revision="$3"
  local retained_count="$4"
  shift 4
  local kept revision_path revision modified_at protected_revision candidate_revision is_protected
  local -a protected_revisions

  if [[ ! "$retained_count" =~ ^[0-9]+$ ]] || (( retained_count < 2 )); then
    echo "Asset revision retention must be at least 2" >&2
    return 1
  fi
  [[ -d "$revision_root/$current_revision" ]] || {
    echo "Current asset revision is missing from candidate: $current_revision" >&2
    return 1
  }

  protected_revisions=()
  for candidate_revision in "$current_revision" "$previous_revision" "$@"; do
    [[ "$candidate_revision" =~ ^[a-f0-9]{16}$ \
      && -d "$revision_root/$candidate_revision" ]] || continue
    is_protected="false"
    for protected_revision in "${protected_revisions[@]}"; do
      if [[ "$protected_revision" == "$candidate_revision" ]]; then
        is_protected="true"
        break
      fi
    done
    [[ "$is_protected" == "true" ]] || protected_revisions+=("$candidate_revision")
  done
  kept=${#protected_revisions[@]}
  if (( kept > retained_count )); then
    echo "Asset revision retention is below the protected revision count" >&2
    return 1
  fi

  while read -r modified_at revision; do
    if (( kept < retained_count )); then
      kept=$((kept + 1))
    else
      rm -rf -- "${revision_root:?}/$revision"
    fi
  done < <(
    for revision_path in "$revision_root"/*; do
      [[ -d "$revision_path" ]] || continue
      revision="${revision_path##*/}"
      [[ "$revision" =~ ^[a-f0-9]{16}$ ]] || continue
      is_protected="false"
      for protected_revision in "${protected_revisions[@]}"; do
        if [[ "$revision" == "$protected_revision" ]]; then
          is_protected="true"
          break
        fi
      done
      [[ "$is_protected" == "false" ]] || continue
      modified_at="$(asset_path_mtime "$revision_path")"
      printf '%s %s\n' "$modified_at" "$revision"
    done | sort -rn
  )
}

prepare_static_release_paths() {
  local incoming_dir="$1"
  local active_dir="$2"
  local current_revision="$3"
  local retained_count="${4:-3}"
  local journal_path="${5:-}"
  local previous_revision="" failed_revision_file failed_revision
  local -a failed_revisions

  previous_revision="$(asset_revision_from_manifest "$active_dir/game-assets/v5/manifest.json" || true)"
  install -d -m 0755 "$incoming_dir/.tasktopia"
  if [[ "$previous_revision" =~ ^[a-f0-9]{16}$ ]]; then
    printf '%s\n' "$previous_revision" > "$incoming_dir/.tasktopia/previous-asset-revision"
  else
    rm -f -- "$incoming_dir/.tasktopia/previous-asset-revision"
  fi

  # Keep exactly the current asset generation as metadata, then merge one
  # previous generation so already-open tabs can lazy-load their hashed chunks.
  record_current_asset_generation "$incoming_dir"
  retain_active_asset_generation "$active_dir" "$incoming_dir"
  retain_failed_asset_generations "$active_dir" "$incoming_dir"
  failed_revisions=()
  for failed_revision_file in "$incoming_dir/.tasktopia/failed-asset-generations"/*.revision; do
    [[ -f "$failed_revision_file" ]] || continue
    failed_revision="$(sed -n '1p' "$failed_revision_file")"
    [[ "$failed_revision" =~ ^[a-f0-9]{16}$ ]] || return 1
    failed_revisions+=("$failed_revision")
  done

  # Keep revision URLs used by already-open tabs in the candidate release.
  prepublish_immutable_dir \
    "$active_dir/game-assets/v5/revisions" \
    "$incoming_dir/game-assets/v5/revisions"
  prune_asset_revisions \
    "$incoming_dir/game-assets/v5/revisions" \
    "$current_revision" \
    "$previous_revision" \
    "$retained_count" \
    "${failed_revisions[@]}"

  # Publish paths from the new image while the old app and static release are
  # still active. Existing content-addressed paths are never overwritten.
  prepublish_immutable_dir "$incoming_dir/assets" "$active_dir/assets" "$journal_path"
  prepublish_immutable_dir \
    "$incoming_dir/game-assets/v5/revisions" \
    "$active_dir/game-assets/v5/revisions" \
    "$journal_path"
}
