import contextlib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile
from backend.maintenance import readiness as r


class ReadinessTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.env={'APP_ENV':'production','APP_ORIGIN':'https://interview.example.com','MAIL_MODE':'smtp',
                  'SMTP_HOST':'smtp.example.com','SMTP_FROM':'HyperSense <team@example.com>',
                  'SMTP_USER':'private-user','SMTP_PASSWORD':'secret-password','GEMINI_API_KEY':'secret-key',
                  'GROQ_API_KEY':'second-secret','HYPERSENSE_DATA_DIR':str(self.root/'data'),
                  'HF_HOME':str(self.root/'cache'),'HYPERSENSE_ADMIN_EMAILS':'admin@example.com'}
        with zipfile.ZipFile(self.root/'face_landmarker.task','w') as z:
            z.writestr('face_detector.tflite',b'fixture');z.writestr('face_landmarks_detector.tflite',b'fixture')
        repo=self.root/'cache'/'hub'/'models--Systran--faster-whisper-small'
        (repo/'refs').mkdir(parents=True);(repo/'refs'/'main').write_text('abc123')
        snapshot=repo/'snapshots'/'abc123';snapshot.mkdir(parents=True)
        for name in ('model.bin','config.json','tokenizer.json','vocabulary.txt'):(snapshot/name).write_text('fixture')

    def tearDown(self):self.temp.cleanup()

    def result(self,**changes):
        return {x['check']:x for x in r.checks({**self.env,**changes},root=self.root,probe=lambda:[])}

    def test_configured_installation_and_probe_cleanup(self):
        result=self.result()
        self.assertFalse([x for x in result.values() if x['status']=='FAIL'])
        self.assertEqual(result['Session cookie']['status'],'PASS')
        self.assertEqual(result['Local Whisper cache']['status'],'PASS')
        self.assertEqual(result['Durable storage']['status'],'WARN')
        self.assertFalse(list((self.root/'data').rglob('probe.sqlite3')))
        text=json.dumps(result)
        for secret in ('secret-password','secret-key','second-secret','private-user'):
            self.assertNotIn(secret,text)

    def test_invalid_production_configuration(self):
        result=self.result(APP_ENV='development',APP_ORIGIN='http://localhost:8000',MAIL_MODE='file',AI_DAILY_LIMIT='zero',TRANSCRIPTION_PROVIDER='unknown',WHISPER_MODEL='large')
        for name in ('Environment','Application URL','Session cookie','Email configuration','Daily request limit','Transcription provider','Local Whisper model'):
            self.assertEqual(result[name]['status'],'FAIL',name)
        result=self.result(SMTP_PORT='wrong',SMTP_PASSWORD='',GEMINI_API_KEY='',GROQ_API_KEY='')
        self.assertEqual(result['Email configuration']['status'],'FAIL')
        self.assertEqual(result['AI provider configuration']['status'],'FAIL')

    def test_storage_failure_and_private_location(self):
        with patch.object(r,'writable',return_value=False):
            result=self.result()
            self.assertEqual(result['Database storage']['status'],'FAIL')
            self.assertNotIn('succeeded',result['Database storage']['message'])
        result=self.result(HYPERSENSE_BACKUP_DIR=str(self.root/'static'/'backups'))
        self.assertEqual(result['Backup storage']['status'],'FAIL')
        self.assertFalse((self.root/'static'/'backups').exists())

    def test_local_required_vs_cloud_fallback_cache(self):
        result=self.result(HF_HOME=str(self.root/'empty'))
        self.assertEqual(result['Local Whisper cache']['status'],'WARN')
        result=self.result(HF_HOME=str(self.root/'empty'),TRANSCRIPTION_PROVIDER='local')
        self.assertEqual(result['Local Whisper cache']['status'],'FAIL')
        (self.root/'face_landmarker.task').write_text('not a model')
        self.assertEqual(self.result()['Face model asset']['status'],'FAIL')

    def test_dependency_errors_do_not_print_raw_output(self):
        with patch.object(r.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='sensitive log text\n["cv2"]',stderr='private error')):
            self.assertEqual(r.dependencies(),['cv2'])
        with patch.object(r.subprocess,'run',return_value=SimpleNamespace(returncode=1,stdout='secret',stderr='secret')):
            self.assertIsNone(r.dependencies())

    def test_json_and_exit_codes(self):
        rows=[{'check':'Test','status':'WARN','message':'Review configuration.'}]
        with patch.object(r,'checks',return_value=rows),contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(r.main(['--json']),0)
        self.assertEqual(json.loads(output.getvalue())['summary']['WARN'],1)
        rows[0]['status']='FAIL'
        with patch.object(r,'checks',return_value=rows),contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(r.main([]),1)

    def test_development_profile(self):
        result={x['check']:x for x in r.checks({**self.env,'APP_ENV':'development','APP_ORIGIN':'http://127.0.0.1:8000','MAIL_MODE':'file'},root=self.root,profile='development',probe=lambda:[])}
        self.assertEqual(result['Environment']['status'],'PASS')
        self.assertEqual(result['Session cookie']['status'],'WARN')
        self.assertEqual(result['Email configuration']['status'],'WARN')
