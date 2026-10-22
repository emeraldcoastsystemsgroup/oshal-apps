# CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise durable one-time reservation, uncertain outcome holds and muted test routes against explicit native-API seams with no real recipient.
import json
from pathlib import Path
import tempfile
import unittest
from communications import AUTHORIZATION,KINDS,TOPICS,run_authorized_tests,targets_from_env

TICKET='11111111-1111-4111-8111-111111111111'
TARGETS={'sms':'+15551234567','voice':'+15551234567','telegram':'-12345'}
class NativeFixture:
    def __init__(self,state,lost=False):self.state=state;self.lost=lost;self.calls=[];self.prefs={};self.channels=list(KINDS);self.legacy=False
    def call(self,path,body=None,confirmed=False):
        if path=='/api/notify/prefs':
            if body:self.prefs[body['topic']]=body
            return {'channels':self.channels,'prefs':list(self.prefs.values())}
        if path.endswith('/workflow'):return {'ticket':{'status':'awaiting_approval'}}
        if path=='/api/notify/test':
            self.assert_reserved(body['channel']);assert confirmed is True;self.calls.append(body['channel'])
            if self.lost and body['channel']=='sms':raise TimeoutError('explicit lost-ack fixture')
            if self.legacy and body['channel']=='telegram':return {'ok':True,'delivered':True,'channel':'telegram','reason':'transport_acknowledged','skipped':False}
            return {'accepted':True,'channel':body['channel'],'deliveryState':'carrier_accepted' if body['channel']!='telegram' else 'transport_acknowledged'}
        raise AssertionError('Unexpected native boundary operation')
    def assert_reserved(self,kind):
        value=json.loads((self.state/('communications-'+AUTHORIZATION+'.json')).read_text());assert value['channels'][kind]['state']=='reserved-outcome-unknown'
class OneTimeNotifications(unittest.TestCase):
    def test_three_authorized_calls_are_reserved_then_muted_and_never_repeated(self):
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory);native=NativeFixture(state);result=run_authorized_tests(native,state,TARGETS,TICKET)
            self.assertTrue(result['allAccepted']);self.assertTrue(result['allTestRoutesMuted']);self.assertEqual(native.calls,list(KINDS))
            self.assertEqual(run_authorized_tests(native,state,TARGETS,TICKET),result);self.assertEqual(native.calls,list(KINDS));self.assertFalse(result['humanReceiptVerified'])
            self.assertNotIn(TARGETS['sms'],json.dumps(result));self.assertNotIn(TARGETS['telegram'],json.dumps(result));self.assertTrue(all(not native.prefs[TOPICS[k]]['enabled'] for k in KINDS))
    def test_uncertain_send_stays_held_while_other_authorized_channels_complete(self):
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory);native=NativeFixture(state,lost=True);result=run_authorized_tests(native,state,TARGETS,TICKET)
            self.assertFalse(result['allAccepted']);self.assertEqual(next(r for r in result['channels'] if r['channel']=='sms')['state'],'uncertain')
            run_authorized_tests(native,state,TARGETS,TICKET);self.assertEqual(native.calls,list(KINDS))
    def test_missing_transport_or_changed_targets_cannot_trigger_additional_sends(self):
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory);native=NativeFixture(state);native.channels=['telegram'];native.legacy=True
            with self.assertRaises(ValueError):run_authorized_tests(native,state,TARGETS,TICKET)
            self.assertEqual(native.calls,[]);native.channels=list(KINDS);run_authorized_tests(native,state,TARGETS,TICKET)
            with self.assertRaises(ValueError):run_authorized_tests(native,state,{**TARGETS,'voice':'+15557654321'},TICKET)
            self.assertEqual(native.calls,list(KINDS))
    def test_environment_selection_is_literal_and_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'fixture.env';path.write_text('TWILIO_TO_NUMBER=+15551234567\nTELEGRAM_CHAT_ID=-12345\nUNRELATED_SECRET=not_selected\n')
            self.assertEqual(targets_from_env(path),TARGETS)
            path.write_text('TWILIO_TO_NUMBER=$(false)\nTELEGRAM_CHAT_ID=-12345\n')
            with self.assertRaises(ValueError):targets_from_env(path)
    def test_ready_channel_can_finish_while_other_rollouts_remain_pending_without_resending_it(self):
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory);native=NativeFixture(state);native.channels=['telegram'];native.legacy=True
            result=run_authorized_tests(native,state,TARGETS,TICKET,('telegram',))
            self.assertFalse(result['allAccepted']);self.assertEqual(native.calls,['telegram'])
            self.assertEqual([r['state'] for r in result['channels']],['pending','pending','accepted'])
            self.assertEqual(result['channels'][2]['acknowledgementProtocol'],'legacy-telegram')
            native.channels=list(KINDS);result=run_authorized_tests(native,state,TARGETS,TICKET)
            self.assertTrue(result['allAccepted']);self.assertEqual(native.calls,['telegram','sms','voice'])
if __name__=='__main__':unittest.main()
