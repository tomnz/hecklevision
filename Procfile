# One worker: messages live in process memory, so every request must hit the same
# process. Threads give concurrency for the polling clients.
web: gunicorn app:app --workers 1 --threads 8
