# Run with: .venv/bin/python -m unittest discover tests
import os
import unittest
from unittest import mock

# Import in local mode, without touching Slack
os.environ.pop('SLACK_BOT_TOKEN', None)
os.environ.pop('SLACK_SIGNING_SECRET', None)

import app  # noqa: E402


class AppTestCase(unittest.TestCase):
    def setUp(self):
        app.messages.clear()
        app.user_last_posted.clear()
        self.client = app.app.test_client()
        self.now = 1000.0
        patcher = mock.patch.object(app.time, 'time', lambda: self.now)
        patcher.start()
        self.addCleanup(patcher.stop)
        # Silence the "[Saving message]" log line
        print_patcher = mock.patch('builtins.print')
        print_patcher.start()
        self.addCleanup(print_patcher.stop)

    def advance(self, secs):
        self.now += secs


class HeckleTest(AppTestCase):
    def test_accepts_message_and_returns_quip(self):
        ok, response = app.heckle(None, 'grilled cheese face', 'tom')
        self.assertTrue(ok)
        self.assertIn(response, app.SUCCESS_RESPONSES)
        self.assertEqual([(m.author, m.text) for m in app.messages], [('tom', 'grilled cheese face')])

    def test_rejects_empty_message(self):
        ok, _ = app.heckle(None, '', 'tom')
        self.assertFalse(ok)
        self.assertEqual(len(app.messages), 0)

    def test_accepts_messages_starting_with_help(self):
        ok, _ = app.heckle(None, 'Help! The killer is behind you', 'tom')
        self.assertTrue(ok)

    def test_length_limit(self):
        self.assertTrue(app.heckle(None, 'x' * app.MESSAGE_LENGTH_LIMIT, 'a')[0])
        self.assertFalse(app.heckle(None, 'x' * (app.MESSAGE_LENGTH_LIMIT + 1), 'b')[0])

    def test_emoji_count_as_four_characters(self):
        self.assertTrue(app.heckle(None, ':thumbsup:' * 50, 'a')[0])
        self.assertFalse(app.heckle(None, ':thumbsup:' * 51, 'b')[0])

    def test_stray_colons_count_normally(self):
        # Two colons with spaces between are not an emoji, so count every character
        text = ': ' + 'x' * (app.MESSAGE_LENGTH_LIMIT - 3) + ' :'
        self.assertFalse(app.heckle(None, text, 'a')[0])

    def test_line_breaks_become_spaces(self):
        app.heckle(None, 'first line\nsecond line\r\nthird', 'tom')
        self.assertEqual(app.messages[-1].text, 'first line second line third')

    def test_whitespace_runs_are_collapsed_and_trimmed(self):
        app.heckle(None, '  lots   of\t\tspace  \n ', 'tom')
        self.assertEqual(app.messages[-1].text, 'lots of space')

    def test_whitespace_only_message_is_rejected(self):
        ok, response = app.heckle(None, ' \n\t ', 'tom')
        self.assertFalse(ok)
        self.assertIn('something to heckle', response)

    def test_length_is_checked_after_cleaning(self):
        # 200 characters once the padding and line breaks are collapsed
        text = '\n\n' + 'x' * 100 + '\n\n\n' + 'y' * 99 + '   '
        self.assertTrue(app.heckle(None, text, 'tom')[0])

    def test_emoji_sequences_survive_cleaning(self):
        app.heckle(None, 'family 👨\u200d👩\u200d👧\nnext', 'tom')
        self.assertEqual(app.messages[-1].text, 'family 👨\u200d👩\u200d👧 next')

    def test_history_is_trimmed(self):
        for i in range(app.MESSAGE_HISTORY + 5):
            app.heckle(None, 'm{}'.format(i), 'user{}'.format(i))
        self.assertEqual(len(app.messages), app.MESSAGE_HISTORY)
        self.assertEqual(app.messages[0].text, 'm5')


class ThrottleTest(AppTestCase):
    def test_web_user_is_throttled_by_name(self):
        self.assertTrue(app.heckle(None, 'one', 'tom')[0])
        ok, response = app.heckle(None, 'two', 'tom')
        self.assertFalse(ok)
        self.assertIn('so soon', response)

    def test_web_name_match_ignores_case(self):
        app.heckle(None, 'one', 'Tom')
        self.assertFalse(app.heckle(None, 'two', 'tom')[0])

    def test_different_web_users_are_independent(self):
        self.assertTrue(app.heckle(None, 'one', 'tom')[0])
        self.assertTrue(app.heckle(None, 'two', 'alice')[0])

    def test_throttle_expires(self):
        app.heckle(None, 'one', 'tom')
        self.advance(app.USER_SILENCE_SECS + 0.01)
        self.assertTrue(app.heckle(None, 'two', 'tom')[0])

    def test_slack_user_is_throttled_by_id(self):
        with mock.patch.dict(app.user_names_by_id, {'U1': 'tom'}):
            self.assertTrue(app.heckle('U1', 'one')[0])
            self.assertFalse(app.heckle('U1', 'two')[0])
            # A web user who happens to share the display name isn't affected
            self.assertTrue(app.heckle(None, 'three', 'tom')[0])

    def test_rejected_message_does_not_reset_throttle(self):
        app.heckle(None, 'one', 'tom')
        self.advance(app.USER_SILENCE_SECS / 2)
        app.heckle(None, 'too soon', 'tom')
        self.advance(app.USER_SILENCE_SECS / 2 + 0.01)
        self.assertTrue(app.heckle(None, 'two', 'tom')[0])


class SlackTextTest(unittest.TestCase):
    def test_unwraps_links(self):
        self.assertEqual(app.slack_to_plain_text('see <https://google.com>'), 'see https://google.com')

    def test_prefers_link_label(self):
        self.assertEqual(app.slack_to_plain_text('<https://x.com/a?b=1&amp;c=2|x.com>'), 'x.com')

    def test_unwraps_mailto(self):
        self.assertEqual(app.slack_to_plain_text('<mailto:a@b.com|a@b.com>'), 'a@b.com')

    def test_replaces_user_mentions(self):
        with mock.patch.dict(app.user_names_by_id, {'U1': 'tom'}):
            self.assertEqual(app.slack_to_plain_text('hi <@U1>'), 'hi @tom')
            self.assertEqual(app.slack_to_plain_text('hi <@U2>'), 'hi @UNKNOWN')

    def test_replaces_channel_mentions(self):
        self.assertEqual(app.slack_to_plain_text('go to <#C1|heckle>'), 'go to #heckle')

    def test_unescapes_entities(self):
        self.assertEqual(app.slack_to_plain_text('a &lt; b &amp;&amp; c &gt; d'), 'a < b && c > d')


class EndpointTest(AppTestCase):
    def submit(self, user_name, text):
        return self.client.post('/submit', data={'user_name': user_name, 'text': text}).get_json()

    def test_submit_and_get(self):
        self.assertTrue(self.submit('tom', 'hello')['ok'])
        self.assertEqual([m['text'] for m in self.client.get('/get').get_json()], ['hello'])

    def test_submit_requires_name(self):
        data = self.submit('  ', 'hello')
        self.assertFalse(data['ok'])
        self.assertIn('name', data['text'])

    def test_submit_rejects_long_name(self):
        self.assertTrue(self.submit('x' * app.NAME_LENGTH_LIMIT, 'hello')['ok'])
        data = self.submit('y' * (app.NAME_LENGTH_LIMIT + 1), 'hello')
        self.assertFalse(data['ok'])
        self.assertIn('name', data['text'])

    def test_get_after_filters(self):
        app.heckle(None, 'old', 'tom')
        self.advance(10)
        app.heckle(None, 'new', 'tom')
        texts = [m['text'] for m in self.client.get('/get?after=1005').get_json()]
        self.assertEqual(texts, ['new'])

    def test_get_with_bad_after_is_a_client_error(self):
        self.assertEqual(self.client.get('/get?after=banana').status_code, 400)

    def test_get_with_empty_after_returns_everything(self):
        app.heckle(None, 'hello', 'tom')
        self.assertEqual(len(self.client.get('/get?after=').get_json()), 1)

    def test_slack_endpoints_disabled_in_local_mode(self):
        self.assertEqual(self.client.post('/post', data={'user_id': 'U1', 'text': 'hi'}).status_code, 503)
        self.assertEqual(self.client.post('/slack-actions', data='{}').status_code, 503)


if __name__ == '__main__':
    unittest.main()
