"""Check the private bucket or retry durable recording cleanup (no secrets printed)."""
import argparse
import json
from backend.config import PROJECT_ROOT  # Loads the project's environment first.
from backend.accounts.object_storage import ObjectStorage
from backend.accounts.recordings import cleanup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('check', 'cleanup'))
    args = parser.parse_args()
    try:
        storage = ObjectStorage()
        storage.check_bucket()
        if args.action == 'check':
            print('Private recording bucket and server credentials are ready.')
        else:
            result = cleanup()
            print(json.dumps(result))
            if result['failed']:
                return 1
    except Exception as error:
        print('Recording storage check/cleanup failed. Check configuration, bucket limits and connectivity.')
        print('Error type: ' + type(error).__name__)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
