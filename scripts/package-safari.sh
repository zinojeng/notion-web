#!/usr/bin/env bash
# Generate Apple's native wrapper from the already-built Safari WebExtension.
# This does not sign, build, install, or publish an app.
set -euo pipefail

if [[ ${1:-} == '--help' || ${1:-} == '-h' ]]; then
  cat <<'HELP'
Usage: bash scripts/package-safari.sh [output-directory] [bundle-identifier]

First run npm ci and npm run build. Requires full Xcode on macOS.
Defaults: artifacts/safari-xcode, com.example.notionweb
Select your own signing team and unique bundle identifiers in Xcode afterward.
An existing output directory is never overwritten.
HELP
  exit 0
fi

if (( $# > 2 )); then
  printf '%s\n' 'Too many arguments. Use --help.' >&2
  exit 2
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
project_root=$(cd -- "$script_dir/.." && pwd)
extension_dir="$project_root/dist/safari"
output_dir=${1:-"$project_root/artifacts/safari-xcode"}
bundle_identifier=${2:-com.example.notionweb}

if [[ ! "$bundle_identifier" =~ ^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$ ]]; then
  printf '%s\n' 'Use a reverse-DNS bundle identifier, for example com.yourname.notionweb.' >&2
  exit 2
fi

if [[ $(uname -s) != Darwin ]]; then
  printf '%s\n' 'Native project generation requires macOS and full Xcode.' >&2
  printf '%s\n' 'For App Store Connect packaging without Xcode, see docs/INSTALL.md.' >&2
  exit 1
fi

if [[ ! -f "$extension_dir/manifest.json" ]]; then
  printf '%s\n' 'Missing dist/safari/manifest.json. Run npm ci and npm run build first.' >&2
  exit 1
fi

if [[ -e "$output_dir" || -L "$output_dir" ]]; then
  printf 'Output already exists: %s\nChoose a new output directory; no files were overwritten.\n' "$output_dir" >&2
  exit 1
fi

packager_path=''
if command -v xcrun >/dev/null 2>&1; then
  for candidate in safari-web-extension-packager safari-web-extension-converter; do
    if candidate_path=$(xcrun --find "$candidate" 2>/dev/null); then
      packager_path=$candidate_path
      break
    fi
  done
fi

if [[ -z "$packager_path" ]]; then
  cat >&2 <<'MISSING'
Apple's Safari packager/converter was not found. Command Line Tools alone are insufficient.
Install full Xcode, open it once to finish setup, and select its Command Line Tools
under Xcode Settings > Locations. Then rerun this script.
Alternatively set DEVELOPER_DIR to your Xcode.app/Contents/Developer for this command.
See docs/INSTALL.md for temporary Safari 18.4+ installation and cloud packaging.
MISSING
  exit 1
fi

printf 'Using %s\nResources: %s\nOutput: %s\n' "$packager_path" "$extension_dir" "$output_dir"
# No --ios-only/--macos-only: generate Apple's default multiplatform wrapper.
# References dist/safari so subsequent npm run build refreshes native resources.
# Deliberately omit --force and --copy-resources.
"$packager_path" "$extension_dir" \
  --project-location "$output_dir" \
  --app-name 'Notion Web' \
  --bundle-identifier "$bundle_identifier" \
  --swift \
  --no-open \
  --no-prompt

printf '\nProject generation completed: %s\n' "$output_dir"
printf '%s\n' 'Review manifest warnings, open the generated .xcodeproj, then configure signing.'
printf '%s\n' 'No native build, device installation, or App Store submission was performed.'
