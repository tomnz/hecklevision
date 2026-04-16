import collections
import os
import random
import re
import threading
import time

import flask
from slack_sdk import WebClient
from slack_sdk.signature import SignatureVerifier


# Tokens belonging to the bot
SLACK_BOT_TOKEN = os.environ['SLACK_BOT_TOKEN']
SLACK_SIGNING_SECRET = os.environ['SLACK_SIGNING_SECRET']

ENABLE_BOT_RELAY = bool(os.environ.get('ENABLE_BOT_RELAY', False))

app = flask.Flask(__name__)
slack_client = WebClient(token=SLACK_BOT_TOKEN)
signature_verifier = SignatureVerifier(SLACK_SIGNING_SECRET)


def paginated(method, **kwargs):
    """Iterate through all pages of a Slack Web API cursor-paginated method."""
    cursor = None
    while True:
        call_kwargs = dict(kwargs)
        if cursor:
            call_kwargs['cursor'] = cursor
        response = method(**call_kwargs)
        yield response
        cursor = (response.get('response_metadata') or {}).get('next_cursor')
        if not cursor:
            return


# Make sure we are joined to the main channel
HECKLE_CHANNEL_NAME = 'heckle'
HECKLE_CHANNEL = None
for page in paginated(slack_client.conversations_list, types='public_channel'):
    for channel in page['channels']:
        if channel['name'] == HECKLE_CHANNEL_NAME:
            HECKLE_CHANNEL = channel['id']
            if not channel['is_member']:
                slack_client.conversations_join(channel=HECKLE_CHANNEL)
            break

    if HECKLE_CHANNEL:
        break


# Build user list so we have usernames
user_names_by_id = {}
for page in paginated(slack_client.users_list):
    for member in page['members']:
        user_names_by_id[member['id']] = member['profile'].get('display_name', None) \
            or member['profile']['real_name']


# Build emoji list
emojis_by_name = {}
for page in paginated(slack_client.emoji_list):
    for name, url in page['emoji'].items():
        if url.startswith('alias:'):
            continue
        emojis_by_name[name] = url


MESSAGE_HISTORY = 100
messages = collections.deque()
message_lock = threading.RLock()


class Message(object):
    def __init__(self, author, text, timestamp):
        self.author = author
        self.text = text
        self.timestamp = timestamp


# Throttle users to the given time between posts
USER_SILENCE_SECS = 0.3
user_last_posted = collections.defaultdict(lambda: 0.0)

# Limit user message length
MESSAGE_LENGTH_LIMIT = 200


SUCCESS_RESPONSES = [
    'Got em!',
    'Oh, so you think you\'re clever huh?',
    'Let\'s see how that one lands...',
    'One heckle, coming right up!',
    'You make heckling look easy!',
    'You funny mother fucker.',
]


def heckle(user_id, text, user_name=None):
    if not text:
        return False, 'You need to give me something to heckle with!'

    if text.lower().startswith('help'):
        return False, 'This is really easy, I promise. Just type `/heckle Wow this movie sucks!` or whatever ' \
                      'you want to heckle with!'

    # Kind of arbitrary, but count emojis as four characters only
    text_len = len(re.sub(r':[^:]*:', 'xxxx', text))
    if text_len > MESSAGE_LENGTH_LIMIT:
        return False, 'Keep your rants to yourself. No more than {} characters please.'.format(MESSAGE_LENGTH_LIMIT)

    user_name = user_name or user_names_by_id.get(user_id, 'UNKNOWN')

    with message_lock:
        timestamp = time.time()

        if user_id:
            last_posted = timestamp - user_last_posted[user_id]
            if last_posted < USER_SILENCE_SECS:
                return False, 'You can\'t heckle again so soon! Try again in {:.1f} seconds.'.format(
                    USER_SILENCE_SECS - last_posted)

        print('[Saving message] {}: {}'.format(user_name, text))
        messages.append(Message(
            author=user_name,
            text=text,
            timestamp=timestamp,
        ))
        user_last_posted[user_id] = timestamp
        # Cleanup old things
        while len(messages) > MESSAGE_HISTORY:
            messages.popleft()

    return True, '{}\nThere may be a short delay before your message appears, you don\'t need to retry.'.format(
        random.choice(SUCCESS_RESPONSES))


@app.route('/post', methods=['POST'])
def post_view():
    data = flask.request.form
    user_id = data['user_id']
    text = data.get('text', None)
    _, response = heckle(user_id, text)

    if ENABLE_BOT_RELAY:
        slack_client.chat_postMessage(
            channel=HECKLE_CHANNEL,
            text='*{}*: {}'.format(user_names_by_id[user_id], text),
        )

    return flask.jsonify({
        'text': response,
    })


@app.route('/get', methods=['GET'])
def get_view():
    after = flask.request.args.get('after', None)
    with message_lock:
        if after:
            response_messages = filter(lambda msg: msg.timestamp > float(after), messages)
        else:
            response_messages = messages

    return flask.jsonify([
        {
            'author': message.author,
            'text': message.text,
            'timestamp': message.timestamp,
        } for message in response_messages
    ])


@app.route('/messages', methods=['GET'])
def messages_view():
    return flask.render_template('messages.html')


@app.route('/', methods=['GET'])
def player_view():
    return flask.render_template('player.html')


@app.route('/submit', methods=['GET', 'POST'])
def submit_view():
    if flask.request.method == 'POST':
        data = flask.request.form
        user_name = data['user_name']
        text = data['text']
        _, response = heckle(None, text, user_name)

        if ENABLE_BOT_RELAY:
            slack_client.chat_postMessage(
                channel=HECKLE_CHANNEL,
                text='*{}*: {}'.format(user_name, text),
            )

        return flask.jsonify({
            'text': response,
        })

    # Manual endpoint for submitting
    return flask.render_template('submit.html')


@app.route('/emoji', methods=['GET'])
def emoji_view():
    return flask.jsonify(emojis_by_name)


handled_events = set()
event_lock = threading.Lock()


USER_PATTERN = re.compile(r'<@([^>]*)>')
CHANNEL_PATTERN = re.compile(r'<#[^>|]*\|?([^>]*)>')


def channel_message(data):
    with event_lock:
        if data['event_id'] in handled_events:
            return
        handled_events.add(data['event_id'])

    message = data['event']
    if message['channel'] != HECKLE_CHANNEL:
        return
    if message.get('subtype', None) or message.get('hidden', None) or message.get('bot_id', None):
        # Not a plain message
        return

    text = message['text']

    # Replace user mentions with actual usernames
    text = re.sub(USER_PATTERN, lambda match: '@{}'.format(user_names_by_id.get(match.group(1), 'UNKNOWN')), text)
    # Replace channel mentions with channel names
    text = re.sub(CHANNEL_PATTERN, lambda match: '#{}'.format(match.group(1) or 'UNKNOWN'), text)

    user_id = message['user']

    success, response = heckle(user_id, text)
    if not success:
        slack_client.reactions_add(
            name='woman-gesturing-no',
            channel=message['channel'],
            timestamp=message['ts'],
        )
        slack_client.chat_postEphemeral(
            channel=message['channel'],
            user=user_id,
            text=response,
            icon_emoji=':woman-gesturing-no:',
        )


@app.route('/slack-actions', methods=['POST'])
def slack_actions():
    """Webhook endpoint for Slack Events API.

    Replaces the old `slackeventsapi.SlackEventAdapter` middleware (archived,
    incompatible with Flask 3). Verifies the request signature, handles the
    initial URL-verification handshake, and dispatches `message` events to
    `channel_message`.
    """
    raw_body = flask.request.get_data()
    if not signature_verifier.is_valid_request(raw_body, dict(flask.request.headers)):
        flask.abort(403)

    payload = flask.request.get_json(silent=True) or {}

    # One-time handshake when Slack validates the endpoint URL.
    if payload.get('type') == 'url_verification':
        return flask.jsonify({'challenge': payload.get('challenge', '')})

    if payload.get('type') == 'event_callback':
        event = payload.get('event') or {}
        if event.get('type') == 'message':
            channel_message(payload)

    # Slack expects any 2xx response; empty body is fine.
    return '', 200


if __name__ == '__main__':
    # Note that we use debug mode to get helpful errors, and so we can serve static content
    # directly from Flask. This app is realllly low stakes, so not concerned about it.
    app.debug = True

    app.run(
        # Listen on all interfaces
        host='0.0.0.0',
        # Grab the port from the environment if present (good for Heroku)
        port=int(os.environ.get('PORT', 7000)),
    )
