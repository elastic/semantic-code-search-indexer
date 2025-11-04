#!/bin/bash
# Test fixture for Bash language support

# Source external scripts
source ./lib/utils.sh
. ./lib/helpers.sh

# Global constants
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly VERSION="1.0.0"

# Global variables
VERBOSE=false
DEBUG_MODE=false

# Export environment variables
export PATH="/usr/local/bin:$PATH"
export LOG_LEVEL="info"

# Function with documentation
# Prints a greeting message
# Arguments:
#   $1 - Name to greet
# Returns:
#   0 on success
function greet() {
    local name="$1"
    echo "Hello, $name!"
    return 0
}

# Another function style (without 'function' keyword)
# Process files in a directory
process_files() {
    local dir="$1"
    
    if [[ ! -d "$dir" ]]; then
        echo "Error: Directory not found: $dir" >&2
        return 1
    fi
    
    for file in "$dir"/*; do
        if [[ -f "$file" ]]; then
            echo "Processing: $(basename "$file")"
        fi
    done
}

# Function with complex logic
calculate() {
    local a="$1"
    local b="$2"
    local result
    
    case "$3" in
        add)
            result=$((a + b))
            ;;
        subtract)
            result=$((a - b))
            ;;
        multiply)
            result=$((a * b))
            ;;
        *)
            echo "Unknown operation" >&2
            return 1
            ;;
    esac
    
    echo "$result"
}

# Function using pipelines
filter_logs() {
    local log_file="$1"
    cat "$log_file" | grep ERROR | sort | uniq
}

# Function with command substitution
get_timestamp() {
    echo "$(date +%Y-%m-%d_%H:%M:%S)"
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -d|--debug)
                DEBUG_MODE=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                echo "Unknown option: $1" >&2
                exit 1
                ;;
        esac
    done
}

# Show help message
show_help() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Options:
    -v, --verbose    Enable verbose output
    -d, --debug      Enable debug mode
    -h, --help       Show this help message

EOF
}

# Main function
main() {
    parse_args "$@"
    
    if [[ "$VERBOSE" == true ]]; then
        echo "Script version: $VERSION"
        echo "Script directory: $SCRIPT_DIR"
    fi
    
    greet "World"
    process_files "/tmp"
    
    local result
    result=$(calculate 10 5 add)
    echo "Calculation result: $result"
    
    echo "Timestamp: $(get_timestamp)"
}

# Trap signals
trap 'echo "Script interrupted"; exit 130' INT TERM

# Run main function if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
